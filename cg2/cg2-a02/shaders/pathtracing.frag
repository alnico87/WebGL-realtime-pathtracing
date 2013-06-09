precision mediump float;

// Intervallgrenzen für Werte von t (des Skalars) bei der Schnittpunktberechnung (Rundungsfehler abfangen). 
const float T_MIN = 0.001;
const float T_MAX = 1000000.0;
// Anzahl "bounces"
const int DEPTH = 3;
// Standard-Konstanten
const float M_PI = 3.14159265359;
const float EPSILON = 0.001;

// structs
struct Ray {
      vec3 start;
      vec3 direction;
};
struct Sphere {
      vec3 center;
      float radius;
};
struct Plane { // Hessesche Normalform
      vec3 n;
      float d;
};
struct CornellBox {
      vec3 minCorner;
      vec3 maxCorner;
};
struct Material {
      bool isLight;
      bool isPerfectMirror;
      bool isDiffuse;
      vec3 Le; // L_emit
      vec3 Kd; // Farbe 
};
struct Hit {
      float t;
      vec3 hitPoint;
      Material material;
      vec3 normal;
};

// uniforms
uniform vec3 La; // Hintergrundfarbe
uniform Sphere spheres[3];
uniform Material sphereMaterials[3];

uniform CornellBox cornellBox;
uniform Material cornellBoxMaterials[6];

uniform vec3 eyePosition;
uniform float secondsSinceStart;
uniform sampler2D texture0;
uniform float textureWeight;

// varyings
varying vec3 rayDirection;
varying vec2 texCoords;

// lokale Variablen
Plane cornellBoxPlanes[6];

/**
 * Schneidet ray mit sphere und liefert t (ein Skalar). Falls zwei Schnittpunkte existieren wird das kleinste t
 * zurückgeliefert; falls ray sphere nicht schneidet T_MAX.
 */
float intersectSphere(Sphere sphere, Ray ray) {
      vec3 toSphere = ray.start - sphere.center;

      // Terme der Mitternachtsformel
      float a = dot(ray.direction, ray.direction);
      float b = 2.0 * dot(toSphere, ray.direction);
      float c = dot(toSphere, toSphere) - sphere.radius * sphere.radius;
      float discriminant = b * b - 4.0 * a * c; // Wurzel

      if (discriminant < 0.0) return T_MAX; // keine Lösung

      if (discriminant == 0.0) { // eine Lösung
            float t0 = -b / (2.0 * a);

            if (t0 <= T_MIN) return T_MAX; // Rundungsfehler abfangen

            return t0;
      } else { // zwei Lösungen
            float t0 = (-b + sqrt(discriminant)) / (2.0 * a);
            float t1 = (-b - sqrt(discriminant)) / (2.0 * a);

            if (t0 <= T_MIN || t1 <= T_MIN) return T_MAX; // Rundungsfehler abfangen

            if (t0 <= t1) {
                  return t0;
            } else {
                  return t1;
            }
      }
}

/**
 * Schneidet ray mit sphere und liefert ein "Hit-structure" mit Hit.material = material und Hit.t = T_MAX falls kein 
 * Schnittpunkt existiert.
 */
Hit hitSphere(Sphere sphere, Ray ray, Material material) {
      Hit hit; hit.t = intersectSphere(sphere, ray);

      if (hit.t == T_MAX) { // kein Schnittpunkt
            return hit; // hit repräsentiert den Schnitt in der Unendlichkeit
      } // else

      hit.hitPoint = ray.start + hit.t * ray.direction;
      hit.material = material;
      hit.normal = normalize(hit.hitPoint - sphere.center);
      return hit;
}

/**
 * Schneidet ray mit der CornellBox und liefert ein "Hit-structure".
 */
Hit hitCornellBox(Ray ray) {
      Hit hit; hit.t = T_MAX; // hit repräsentiert zunächst den Schnitt in der Unendlichkeit

      for (int i = 0; i < 6; i ++) {
            float denominator = dot(cornellBoxPlanes[i].n, ray.direction); // z. dt. Nenner

            if (abs(denominator) < EPSILON) continue; // keine Division durch "0"

            float tmpT = (cornellBoxPlanes[i].d - dot(cornellBoxPlanes[i].n, ray.start)) / denominator;

            // Intervallgrenzen checken und kleinstes t suchen (siehe CornellBox)
            if (tmpT <= T_MIN || T_MAX <= tmpT || hit.t < tmpT) continue;

            hit = Hit(tmpT, ray.start + tmpT * ray.direction, cornellBoxMaterials[i], cornellBoxPlanes[i].n);
      }
      return hit;
}

/**
 * Schneidet alle Szeneobjekte mit ray und liefert den naheliegendsten Hit.
 */
Hit sceneFirstHit(Ray ray) {
      Hit hit; hit.t = T_MAX; // hit repräsentiert zunächst den Schnitt in der Unendlichkeit

      // 1. Kugeln schneiden
      for (int i = 0; i < 3; i++) { // wegen GLSL 1.0 muss man wissen, wieviele Kugeln die Szene hat...
            Hit tmpHit = hitSphere(spheres[i], ray, sphereMaterials[i]);
            if (tmpHit.t < hit.t) { // der naheliegendste Schnittpunkt zählt
                  hit = tmpHit;
            }
      }

      // 2. "CornellBox" schneiden
      Hit cornellBoxHit = hitCornellBox(ray);
      if (cornellBoxHit.t < hit.t) hit = cornellBoxHit;

      return hit;
}

vec3 Li(vec3 n, vec3 x) {
      vec3 res = vec3(0.0, 0.0, 0.0);

      for (int i = 0; i < 1; i++) { // wegen GLSL 1.0 muss man wissen, wieviele Lichter die Szene hat...
            // die Lichter befinden sich am Anfang der Reihungen
            vec3 lightPosition = spheres[i].center; // kein Sampling
            vec3 lightColor = sphereMaterials[i].Le;
            vec3 s = normalize(lightPosition - x); // to light source

            // ist Licht sichtbar?
            Hit hit = sceneFirstHit(Ray(x, s));
            if (hit.t < T_MAX && !hit.material.isLight) break;

            float theCos = dot(n, s);
            if (theCos >= 0.0) res += lightColor * theCos;
      }
      return res;
}

/**
 * konstant
 */
vec3 perfectMirrorBRDF() {
      return vec3(1.0, 1.0, 1.0);
}

/**
 * Liefert den perfekten Ausfallvektor. Achtung: i ist der "incident vector" --> Richtung beachten!
 */
float perfectMirrorNextDirection(out vec3 L, vec3 i, vec3 n) {
      L = normalize(reflect(i, n)); // TODO already normalized?
      return 1.0;
}

/**
 * konstant
 */
vec3 diffuseBRDF(Material material) {
      return material.Kd;
}

/**
 * Liefert, je nach scale und seed, einen (Pseudo-) Zufallswert.
 * @author vgl. Evan Wallace
 */
float random(vec3 scale, float seed) {
      return fract(sin(dot(gl_FragCoord.xyz + seed, scale)) * 43758.5453 + seed);
}

/**
 * Liefert einen (pseudo-) zufälligen Ausfallvektor aus der Halbkugel (out-Parameter L) und seine Wahrscheinlichkeit als
 * "return value" der Funktion.
 * @author vgl. Szirmay-Kalos, S. 104
 */
float diffuseNextDirection(out vec3 L, vec3 N, vec3 V, float seed) {
      float u = random(vec3(12.9898, 78.233, 151.7182), seed);
      float v = random(vec3(63.7264, 10.873, 623.6736), seed);

      float theta = asin(sqrt(u));
      float phi = M_PI * 2.0 * v;
      vec3 O = cross(N, vec3(0, 0, 1));

      if (length(O) < EPSILON) {
            O = cross(N, vec3(0, 1, 0));
      }

      vec3 P = cross(N, O);

      L = normalize(N * cos(theta) + O * sin(theta) * cos(phi) + P * sin(theta) * sin(phi)); // TODO already normalized?

      float prob = cos(theta) / M_PI;
      return prob;
}

/**
 * Hauptschleife
 */
vec3 pathTrace() {
      Ray ray = Ray(eyePosition, normalize(rayDirection)); // Primärstrahl
      vec3 color = vec3(0.0, 0.0, 0.0);
      int n = 1; // laut GLSL 1.0 kann hier nicht einfach die Schleifenvariable j stehen, nun also n...

      for (int j = 1; j <= DEPTH; j++) { // entspricht der Summe von j = 1 bis n
            Hit hit = sceneFirstHit(ray);

            // Schnittpunkt?
            if (hit.t == T_MAX) return La;

            // Le
            color += hit.material.Le;

            if (hit.material.isLight) break;

            // Li
            // color += Li(hit.normal, hit.hitPoint);

            // BRDF und Co.
            vec3 brdf; vec3 nextDirection;
            float prob;

            if (hit.material.isPerfectMirror) {
                  brdf = perfectMirrorBRDF();
                  prob = perfectMirrorNextDirection(nextDirection, ray.direction, hit.normal);
            } else if (hit.material.isDiffuse) {
                  brdf = diffuseBRDF(hit.material);
                  prob = diffuseNextDirection(nextDirection, hit.normal, -ray.direction, secondsSinceStart + float(j));
            }

            if (prob < EPSILON) break; // Russian Roulette

            float cost = dot(nextDirection, hit.normal);
            if (cost < 0.0) cost = -cost;
            if (cost < EPSILON) break;

            // color akkumulieren
            color += brdf * cost / prob;

            ray = Ray(hit.hitPoint, nextDirection); // new ray

            if (j == DEPTH) return La; // entspricht if (j > DEPTH) return La; 

            n++; // zweite Schleifenvariable
      }

      return color / float(n); // * (1 / n)
}

void main() {
      // initialisiere CornellBox-Ebenen
      cornellBoxPlanes[0] = Plane(vec3( 1.0,  0.0,  0.0),  cornellBox.minCorner.x); // left
      cornellBoxPlanes[1] = Plane(vec3(-1.0,  0.0,  0.0), -cornellBox.maxCorner.x); // right
      cornellBoxPlanes[2] = Plane(vec3( 0.0,  1.0,  0.0),  cornellBox.minCorner.y); // bottom
      cornellBoxPlanes[3] = Plane(vec3( 0.0, -1.0,  0.0), -cornellBox.maxCorner.y); // top
      cornellBoxPlanes[4] = Plane(vec3( 0.0,  0.0,  1.0),  cornellBox.minCorner.z); // far
      cornellBoxPlanes[5] = Plane(vec3( 0.0,  0.0, -1.0), -cornellBox.maxCorner.z); // near

      // "blending" vgl. Evan Wallace
      gl_FragColor = mix(vec4(pathTrace(), 1.0), texture2D(texture0, texCoords), textureWeight);
}
