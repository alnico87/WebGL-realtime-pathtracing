/*
  *
 * Module main: CG2 Aufgabe 2, Winter 2012/2013
 * (C)opyright Hartmut Schirmacher, hschirmacher.beuth-hochschule.de 
 *
 */


/* 
 *  RequireJS alias/path configuration (http://requirejs.org/)
 */

requirejs.config({
    paths: {

        // jquery library
        "jquery": [
            // try content delivery network location first
            'http://ajax.googleapis.com/ajax/libs/jquery/1.7.2/jquery.min',
            //If the load via CDN fails, load locally
            '../lib/jquery-1.7.2.min'],

        // gl-matrix library
        "gl-matrix": "../lib/gl-matrix-1.3.7"

    }
});


/*
 * The function defined below is the "main" module,
 * it will be called once all prerequisites listed in the
 * define() statement are loaded.
 *
 */

/* requireJS module definition */
define(["jquery", "gl-matrix", "util", "webgl-debug",
        "program", "shaders", "animation", "html_controller",
        "models/triangle", "models/cube", "models/band", "models/Stage",
        "texture"],
       (function($, glmatrix, util, WebGLDebugUtils,
                    Program, shaders, Animation, HtmlController,
                    Triangle, Cube, Band, Stage,
                    Texture) {

    "use strict";

    /*
     *  This function asks the HTML Canvas element to create
     *  a context object for WebGL rendering.
     *
     *  It also creates awrapper around it for debugging
     *  purposes, using webgl-debug.js
     *
     */

    var makeWebGLContext = function(canvas_name) {

        // get the canvas element to be used for drawing
        var canvas=$("#"+canvas_name).get(0);
        if(!canvas) {
            throw "HTML element with id '"+canvas_name + "' not found";
            return null;
        };

        // get WebGL rendering context for canvas element
        var options = {alpha: true, depth: true, antialias:true};
        var gl = canvas.getContext("webgl", options) ||
                 canvas.getContext("experimental-webgl", options);
        if(!gl) {
            throw "could not create WebGL rendering context";
        };

        // create a debugging wrapper of the context object
        var throwOnGLError = function(err, funcName, args) {
            throw WebGLDebugUtils.glEnumToString(err) + " was caused by call to: " + funcName;
        };
        var gl=WebGLDebugUtils.makeDebugContext(gl, throwOnGLError);

        return gl;
    };

    /*
     * create an animation that rotates the scene around
     * the Y axis over time. It also rotates the scene
     * around the X axis by a fixed amount, to get a good
     * angled 3D view.
     *
     */
    var makeAnimation = function(scene) {

        // create animation to rotate the scene
        var animation = new Animation( (function(t) {

            var matrix = mat4.identity();
            // mat4.rotate(matrix, 25 * Math.PI/180, [1,0,0]); // rotate by 25° around the X axis to get a tilted perspective

            // rotation around Y axis, depending on animation time
            var angle = t/1000 * animation.customSpeed / 180*Math.PI; // 10 deg/sec, in radians
            mat4.rotate(matrix, angle, [0,1,0]);

            // set the scene's transformation to what we have calculated
            scene.transformation = matrix;

            // (re-) draw the scene
            scene.draw();

        } )); // end animation callback

        // set an additional attribute that can be controlled from the outside
        animation.customSpeed = 20;

        return animation;

    };


    /*
     * main program, to be called once the document has loaded
     * and the DOM has been constructed
     *
     */

    $(document).ready( (function() {

        // catch errors for debugging purposes
        try {

            console.log("document ready - starting!");

            // create WebGL context object for the named canvas object
            var gl = makeWebGLContext("drawing_area"),
                framebuffer = gl.createFramebuffer(),
                start = new Date();

            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            framebuffer.width = 512;
            framebuffer.height = 512;

            var texture = new Texture.Texture2D(gl).init_2(framebuffer.width, framebuffer.height, null);
            texture.setTexParameter(gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            texture.setTexParameter(gl.TEXTURE_MIN_FILTER, gl.NEAREST);

            // a simple scene is an object with a few objects and a draw() method
            var MyScene = function(gl, transformation) {

                // store the WebGL rendering context
                this.gl = gl;

                // for rotation - this will be accessed directly by Animation
                this.transformation = transformation || mat4.identity();

                // create WebGL programs using constant red / black color
                this.prog_red = new Program(gl,
                    shaders("noColor_vert"),
                    shaders("constantColor_frag")
                );

                // create WebGL program using per-vertex-color
                this.prog_vertexColor = new Program(gl,
                    shaders("perVertexColor_vert"),
                    shaders("perVertexColor_frag")
                );

                this.prog_pathtracing = new Program(gl,
                    shaders("pathtracing_vert"),
                    shaders("pathtracing_frag")
                );

                this.prog_texture = new Program(gl,
                    shaders("texture_vert"),
                    shaders("texture_frag")
                );

                // create some objects to be drawn
                this.triangle = new Triangle(gl);
                this.cube     = new Cube(gl);
                this.band     = new Band(gl, { radius: 0.4, height: 0.2, segments: 50 } );
                this.stage = new Stage(gl);

                // for the UI - this will be accessed directly by HtmlController
                this.drawOptions = {
                    "Triangle": false,
                    "Cube": false,
                    "Band": false,
                    "Stage": true
                };
            };
            // the scene's draw method draws whatever the scene wants to draw
            MyScene.prototype.draw = function() {

                // set all the required uniform variables in all used programs
                var setUniforms = function(program, transformation) {

                    // you have to use a program before you set uniforms in it
                    program.use();

                    // set up the projection matrix: orthographic projection, aspect ratio: 1:1
                    program.setUniform("projectionMatrix", "mat4", mat4.ortho(-1, 1, -1, 1, -1, 1));

                    // set up the modelview matrix
                    program.setUniform("modelViewMatrix", "mat4", transformation);

                };
                setUniforms(this.prog_red, this.transformation);
                setUniforms(this.prog_vertexColor, this.transformation);

                setUniforms(this.prog_pathtracing, this.transformation);
                this.prog_pathtracing.setUniform("eyePosition", "vec3", [0, 0, 2.0]);
                this.prog_pathtracing.setUniform("secondsSinceStart", "float", (new Date() - start) * 0.001);

                this.prog_pathtracing.setUniform("spheres[0].center", "vec3", [0, 0, -10]);
                this.prog_pathtracing.setUniform("spheres[0].radius", "float", 1);
                this.prog_pathtracing.setUniform("sphereMaterials[0].isLight", "bool", true);
                this.prog_pathtracing.setUniform("sphereMaterials[0].isPerfectMirror", "bool", false);
                this.prog_pathtracing.setUniform("sphereMaterials[0].isDiffuse", "bool", false);

                this.prog_pathtracing.setUniform("spheres[1].center", "vec3", [-2.5, 0, -10]);
                this.prog_pathtracing.setUniform("spheres[1].radius", "float", 1);
                this.prog_pathtracing.setUniform("sphereMaterials[1].isLight", "bool", false);
                this.prog_pathtracing.setUniform("sphereMaterials[1].isPerfectMirror", "bool", true);
                this.prog_pathtracing.setUniform("sphereMaterials[1].isDiffuse", "bool", false);

                this.prog_pathtracing.setUniform("spheres[2].center", "vec3", [2.5, 0 , -10]);
                this.prog_pathtracing.setUniform("spheres[2].radius", "float", 1);
                this.prog_pathtracing.setUniform("sphereMaterials[2].isLight", "bool", false);
                this.prog_pathtracing.setUniform("sphereMaterials[2].isPerfectMirror", "bool", true);
                this.prog_pathtracing.setUniform("sphereMaterials[2].isDiffuse", "bool", false);

                this.prog_pathtracing.setUniform("cornellBox.minCorner", "vec3", [-4.0, -2.0, -12.0]);
                this.prog_pathtracing.setUniform("cornellBox.maxCorner", "vec3", [4.0, 2.0, 12.0]);
                this.prog_pathtracing.setUniform("cornellBoxMaterial.isLight", "bool", false);
                this.prog_pathtracing.setUniform("cornellBoxMaterial.isPerfectMirror", "bool", false);
                this.prog_pathtracing.setUniform("cornellBoxMaterial.isDiffuse", "bool", true);

                setUniforms(this.prog_texture, this.transformation);
                this.prog_texture.setTexture("texture0", 0, texture);

                // shortcut
                var gl = this.gl;

                // clear color and depth buffers
                gl.clearColor(0.7, 0.7, 0.7, 1.0);
                gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

                // enable depth testing
                gl.enable(gl.DEPTH_TEST);

                // draw the objects
                if(this.drawOptions["Triangle"]) {
                    this.triangle.draw(gl, this.prog_vertexColor);
                }
                if(this.drawOptions["Cube"]) {
                    this.cube.draw(gl, this.prog_red);
                }
                if(this.drawOptions["Band"]) {
                    this.band.draw(gl, this.prog_red);
                }
                if(this.drawOptions["Stage"]) {
                    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
                    this.stage.draw(gl, this.prog_pathtracing);
                    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

                    this.stage.draw(gl, this.prog_texture);
                }
            };

            // Texture.onAllTexturesLoaded(function () {
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture.glTextureObject(), 0);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);

            // initial transformation
            var matrix = mat4.identity();
            // mat4.rotate(matrix, 25 * Math.PI/180, [1,0,0]); // tilt view by 25° from above

            // create scene and animation, and start drawing
            var scene = new MyScene(gl, matrix);
            var animation = makeAnimation(scene); // do not start yet
            scene.draw();

            // create HTML controller that handles all the interaction of
            // HTML elements with the scene and the animation
            var controller = new HtmlController(scene,animation);
            // });

        // end of try block
        } catch(err) {
            if($("#error")) {
                $('#error').text(err.message || err);
                $('#error').css('display', 'block');
            };
            window.console.log("exception: " + (err.message || err));;
            throw err;
        };


    })); // $(document).ready()


})); // define module
        

