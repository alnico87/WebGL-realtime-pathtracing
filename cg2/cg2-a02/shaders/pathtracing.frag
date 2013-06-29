#version 100
precision mediump float;

// Intervallgrenzen für Werte von t (des Skalars) bei der Schnittpunktberechnung (Rundungsfehler abfangen)
#define T_MIN 0.001
#define T_MAX 1000000.0

// Anzahl "bounces"
#define DEPTH 3

#define M_PI 3.14159265359
#define EPSILON 0.001

// "struct"-Orientiertes programmieren
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
struct Mesh {
	sampler2D data;
	vec2 onePixel; // Größe eines Pixel zur Adressierung
};
struct Material {
	// zwei Boolesche Variablen zur Auswahl der BRDF
	bool isPerfectMirror;
	bool isDiffuse;
	vec3 Le; // L_emit
	vec3 Kd; // Farbe 
};
struct CornellBox {
	Plane planes[6];
	Material materials[6];
	// eigentlich redundant, aber benötigt für Mittelpunktberechnung (siehe Li-Berechnung)
	vec3 minCorner;
	vec3 maxCorner;
};
struct Hit {
	// eigentlich sind t und hitPoint redundant, aber t ist eine schnelle Metrik für die Abstandsmessung und hitPoint
	// ist hier einfach gut aufgehoben
	float t;
	vec3 hitPoint;
	Material material;
	vec3 normal;
};

// uniforms
uniform vec3 La; // Hintergrundfarbe

uniform Sphere spheres[2];
uniform Material sphereMaterials[2];

uniform Mesh mesh;
uniform Material meshMaterial;

uniform CornellBox cornellBox;

// Benötigt für Zufallsvariable
uniform float secondsSinceStart;

uniform sampler2D texture0;
uniform float textureWeight;
uniform vec3 eyePosition;

// varyings
varying vec3 rayDirection;
varying vec2 texCoords;

/**
 * Schneidet ray mit sphere und liefert ein Hit; Hit.t "ist Element von" [tMin, ..., tMax]. Rundungsfehler werden somit
 * abgefangen. Falls zwei Schnittpunkte existieren, wird der naheliegendste zurückgeliefert; falls ray sphere nicht 
 * schneidet der "Schnitt in der Unendlichkeit".
 */
Hit hitSphere(Ray ray, Sphere sphere, float tMin, float tMax, Material material) {
	Hit hit; hit.t = tMax; // hit repräsentiert zunächst den "Schnitt in der Unendlichkeit"
	vec3 toSphere = ray.start - sphere.center;

	// Terme der Mitternachtsformel
	float a = dot(ray.direction, ray.direction);
	float b = 2.0 * dot(toSphere, ray.direction);
	float c = dot(toSphere, toSphere) - sphere.radius * sphere.radius;
	float discriminant = b * b - 4.0 * a * c; // Wurzel

	if (discriminant < 0.0) return hit; // keine Lösung

	if (discriminant == 0.0) { // eine Lösung
		float t = -b / (2.0 * a);

		if (t <= tMin || tMax <= t) return hit;

		hit.t = t;
		hit.hitPoint = ray.start + hit.t * ray.direction;
		hit.material = material;
		hit.normal = normalize(hit.hitPoint - sphere.center);
		return hit;
	} else { // zwei Lösungen
		float t0 = (-b + sqrt(discriminant)) / (2.0 * a);
		float t1 = (-b - sqrt(discriminant)) / (2.0 * a);
		float t = min(t0, t1);

		if (t <= tMin || tMax <= t) return hit;

		hit.t = t;
		hit.hitPoint = ray.start + hit.t * ray.direction;
		hit.material = material;
		hit.normal = normalize(hit.hitPoint - sphere.center);
		return hit;
	}
}

/**
 * Schneidet ray mit der CornellBox und liefert ein "Hit-structure".
 */
Hit hitCornellBox(Ray ray) {
	Hit hit; hit.t = T_MAX; // hit repräsentiert zunächst den Schnitt in der Unendlichkeit

	for (int i = 0; i < 6; i ++) {
		float denominator = dot(cornellBox.planes[i].n, ray.direction); // z. dt. Nenner

		if (abs(denominator) < EPSILON) continue; // keine Division durch "0"

		float tmpT = (cornellBox.planes[i].d - dot(cornellBox.planes[i].n, ray.start)) / denominator;

		// Intervallgrenzen checken und kleinstes t suchen (siehe CornellBox)
		if (tmpT <= T_MIN || T_MAX <= tmpT || hit.t < tmpT) continue;

		hit = Hit(tmpT, ray.start + tmpT * ray.direction, cornellBox.materials[i], cornellBox.planes[i].n);
	}
	return hit;
}

/**
 * Liefert den RGB-Wert von sampler an der Stelle [x, y], "Pixel-Welt".
 */
vec3 readMeshSamplerBuffer(sampler2D sampler, int x, int y) {
	vec3 res = texture2D(sampler, vec2(x, y) * mesh.onePixel).xyz * 255.0;

	// Zweierkomplement
	bvec3 b = greaterThan(res, vec3(127.0, 127.0, 127.0));
	res -= vec3(256.0, 256.0, 256.0) * vec3(b);

	return res;
}

/**
 * Schneidet ray mit (uniform) mesh und liefert ein "Hit-structure".
 */
Hit hitMesh(Ray ray) {
	Hit hit; hit.t = T_MAX; // hit repräsentiert zunächst den Schnitt in der Unendlichkeit

	for (int i = 0; i < 256; i++) { // Dank der GLSL 1.0 muss man wissen, welche Breite die Texturen haben...
		vec3 indices = readMeshSamplerBuffer(mesh.data, i, 3);

		// Abbrechen sobald ein Triangle: (0, 0, 0), (0, 0, 0), (0, 0, 0) vorkommt; Rundungsfehler beachten!
		if (indices.x < EPSILON && indices.y < EPSILON && indices.z < EPSILON) break;

		vec3 v0 = readMeshSamplerBuffer(mesh.data, int(ceil(indices.x)), 2); // ceil durch Test
		vec3 v1 = readMeshSamplerBuffer(mesh.data, int(ceil(indices.y)), 2);
		vec3 v2 = readMeshSamplerBuffer(mesh.data, int(ceil(indices.z)), 2);

		// Moeller, S. 581
		vec3 e1 = v1 - v0;
		vec3 e2 = v2 - v0;
		vec3 p = cross(ray.direction, e2);
		float a = dot(e1, p);
		if (a > -EPSILON && a < EPSILON) continue; // "REJECT"
		float f = 1.0 / a;
		vec3 s = ray.start - v0;
		float u = f * dot(s, p);
		if (u < 0.0 || u > 1.0) continue; // "REJECT"
		vec3 q = cross(s, e1);
		float v = f * dot(ray.direction, q);
		if (v < 0.0 || (u + v) > 1.0) continue; // "REJECT"
		float t = f * dot(e2, q);
		// END Moeller

		if (t <= T_MIN || T_MAX <= t || hit.t < t) continue;

		hit.t = t;
		hit.hitPoint = ray.start + t * ray.direction;
		hit.material = meshMaterial;
		hit.normal = normalize(readMeshSamplerBuffer(mesh.data, i, 1));
	}
	return hit;
}

/**
 * Schneidet alle Szeneobjekte mit ray und liefert den naheliegendsten Hit.
 */
Hit sceneFirstHit(Ray ray) {
	Hit hit; hit.t = T_MAX; // hit repräsentiert zunächst den Schnitt in der Unendlichkeit

	// 1. Kugeln schneiden
	for (int i = 0; i < 2; i++) { // wegen GLSL 1.0 muss man wissen, wieviele Kugeln die Szene hat...
		Hit tmpHit = hitSphere(ray, spheres[i], T_MIN, T_MAX, sphereMaterials[i]);
		if (tmpHit.t < hit.t) { // der naheliegendste Schnittpunkt zählt
			hit = tmpHit;
		}
	}

	// 2. "CornellBox" schneiden (leider zu langsam)
	// Hit cornellBoxHit = hitCornellBox(ray);
	// if (cornellBoxHit.t < hit.t) hit = cornellBoxHit;

	// 3. Mesh schneiden
	Hit meshHit = hitMesh(ray);
	if (meshHit.t < hit.t) hit = meshHit;

	return hit;
}

/**
 * Berechnet die lokale Beleuchtung in x, mit s ist der Vektor zur Lichtquelle und n die Normale.
 */
void Li(vec3 x, vec3 s, vec3 n, vec3 lightColor, inout vec3 res) {
	// ist Licht sichtbar?
	Hit hit = sceneFirstHit(Ray(x, s));
	if (hit.t < T_MAX && length(hit.material.Le) == 0.0) return;

	float theCos = dot(n, s);
	if (theCos >= 0.0) res += lightColor * theCos;
}

/**
 * Berechnet die lokale Beleuchtung in hit.
 */
vec3 prepareLiCalculation(Hit hit) {
	vec3 res = vec3(0.0, 0.0, 0.0);

	// 1. Kugel-Lichter
	for (int i = 0; i < 2; i++) { // wegen GLSL 1.0 muss man wissen, wieviele Lichter die Szene hat...
		// die Lichter befinden sich am Anfang der Reihungen
		vec3 toSource = normalize(spheres[i].center - hit.hitPoint); // TODO Sampling!
		vec3 lightColor = sphereMaterials[i].Le;

		Li(hit.hitPoint, toSource, hit.normal, lightColor, res);
	}

	// 2. Cornell Box-Wand-Lichter
	vec2 centerXY = vec2((cornellBox.minCorner.x + cornellBox.maxCorner.x) / 2.0,
				   (cornellBox.minCorner.y + cornellBox.maxCorner.y) / 2.0); // TODO Sampling

	// TODO noch "hard coded"! Und zwar leuchtet die "top plane"
	vec3 toCornellBoxNearSource = normalize(vec3(centerXY, cornellBox.maxCorner.z) - hit.hitPoint);
	Li(hit.hitPoint, toCornellBoxNearSource, hit.normal, cornellBox.materials[5].Le, res);

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
 * Path tracing (vgl. Szirmay-Kalos, S. 112; Kevin Suffern S. 547 - 549)
 */
vec3 pathTrace() {
	Ray ray = Ray(eyePosition, normalize(rayDirection)); // Primärstrahl
	vec3 tmpColor = vec3(1, 1, 1);
	vec3 resColor = vec3(0, 0, 0);

	for (int j = 0; j < DEPTH; j++) { // entspricht der Summe von j = 0 bis unendlich
		Hit hit = sceneFirstHit(ray);

		// Fall: kein Schnittpunkt
		if (hit.t == T_MAX) return La;

		// Fall: Licht geschnitten
		if (length(hit.material.Le) > 0.0) {
			if (j == 0) { // ...von einem Primärstrahl?
				return hit.material.Kd; // -> Lichtdesign
			} else {
				return resColor + hit.material.Le;
			}
		}

		// L_i (leider zu langsam)
		// tmpColor += prepareLiCalculation(hit);

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

		if (prob < EPSILON) return La; // Russian Roulette

		float cost = dot(nextDirection, hit.normal);
		if (cost < 0.0) cost = -cost;
		if (cost < EPSILON) return La;

		// tmpColor akkumulieren
		tmpColor *= brdf * cost / prob;
		resColor = tmpColor;

		// Iteration
		ray = Ray(hit.hitPoint, nextDirection); // neuer Strahl
	}
	return La; // Fall: maximale "depth" erreicht
}

void main() {
	// "blending" vgl. Evan Wallace
	gl_FragColor = mix(vec4(pathTrace(), 1.0), texture2D(texture0, texCoords), textureWeight);
}
