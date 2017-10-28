const gulp = require('gulp');
const source = require('vinyl-source-stream');
const buffer = require('vinyl-buffer');
const { spawn } = require('child_process');
const path = require('path');
const del = require('del');
const chalk = require('chalk');
const uglify = require('gulp-uglify');
const ts = require('gulp-typescript');
const execa = require('execa');
const sass = require('gulp-sass');
const sourcemaps = require('gulp-sourcemaps');
const browserify = require('browserify');
const browserifyShim = require('browserify-shim');
const tsify = require('tsify');
const watchify = require('watchify');

const config = {
    src: 'src',
    dist: 'dist',
    testDist: 'test_dist',
    entryPoint: 'src/app/index.tsx',
    testPath: 'test',
    serverPort: 8080
}

function bundler() {
    let plugins = Array.prototype.slice.call(arguments);
    let opts = {
        entries: config.entryPoint,
        cache: {},
        packageCache: {},
        debug: true,
        plugin: plugins,
        transform: [
            [browserifyShim, { global: true } ]
        ]
    };

    return browserify(opts)
}

function compileTypeScript(bundler) {
    console.log(chalk.cyan("Browserify: starting bundling..."));

    let entryPointDir = path.dirname(config.entryPoint);
    let dest = entryPointDir.substr(config.src.length)
    if (dest.startsWith('/')) dest = dest.substr(1)
    
    return bundler
        .bundle()
        .on('error', e => console.error(chalk.red(e.toString())))
        .pipe(source('bundle.js'))
        .pipe(buffer())
        .pipe(sourcemaps.init({ loadMaps: true }))
        .pipe(uglify())
        .pipe(sourcemaps.write('.'))
        .pipe(gulp.dest(path.join(config.dist, dest)))

}


function watchTypeScript() {
    const b = bundler(
        [ tsify, { stopOnError: false } ],
        watchify
    );
    const run = () => compileTypeScript(b);

    b.on('update', run);
    b.on('log', m => console.log(chalk.cyan("Browserify: " + m)));
    return compileTypeScript(b);
}


gulp.task('typescript', () => compileTypeScript(bundler(tsify)));
gulp.task('typescript:watch', watchTypeScript);

const contentPatterns = [
    path.join(config.src, '**/*.html'),
    path.join(config.src, 'images/**/*.*')
];

function copyContent() {
    return gulp.src(contentPatterns, { base: config.src }).pipe(gulp.dest(config.dist));
}

gulp.task('content', copyContent);
gulp.task('content:watch', () => gulp.watch(contentPatterns, gulp.task('content')));

const stylePatterns = [
    path.join(config.src, 'styles/**')
];

function compileStyles() {
    return gulp.src(stylePatterns, { base: config.src })
        .pipe(sourcemaps.init())
        .pipe(sass({ includePaths: [['node_modules']]}).on('error', sass.logError))
        .pipe(sourcemaps.write('.'))
        .pipe(gulp.dest('dist'));
}

gulp.task('styles', compileStyles);
gulp.task('styles:watch', () => gulp.watch(stylePatterns, gulp.task('styles')));

let tsProject = ts.createProject('tsconfig.json', {
    module: 'CommonJS',
    target: 'es2015',
    lib: ['es2015', 'DOM'],
    sourceMap: true
});

const typeScriptPatterns = [
    path.join(config.src, '**/*.ts'),
    path.join(config.src, '**/*.tsx')
];

function compileTests() {
    return new Promise((resolve, reject) => {
        let compileErrors = 0;
        let lastRunCompile = gulp.lastRun('test:compile');
        let lastRunSilent = gulp.lastRun('test:silent');
        let lastRun = Math.max(lastRunSilent || 0, lastRunCompile || 0);

        const stream = gulp.src(typeScriptPatterns, { since: lastRun })
            .pipe(tsProject())
            .on('error', () => compileErrors++)
            .js.pipe(gulp.dest(config.testDist));

        stream.on('finish', () => {
            if (compileErrors > 0) {
                reject(new Error(`Failed to build with ${compileErrors} errors`));
            } else {
                resolve();
            }
        });
    });
}
gulp.task('test:compile', compileTests);

function runTests() {
    let args = [ path.join(config.testDist, config.testPath) ];
    return execa('./node_modules/.bin/ava', args, { stdio: 'inherit' });
}

gulp.task('test:run', runTests);
gulp.task('test', gulp.series('test:compile', 'test:run'));

function testSilent() {
    return compileTests().then(runTests).then(() => true, e => {
        console.error(chalk.red(e));
        return true;
    });
}
gulp.task('test:silent', testSilent);
gulp.task('test:watch', () => gulp.watch(typeScriptPatterns, gulp.task('test:silent')));

gulp.task('clean', () => del(config.dist))

let server;
function runServer() {
   if (server) server.kill();

    let serverParams = ['node_modules/http-server/bin/http-server', 'dist', '-p', config.serverPort]
    server = spawn('node', serverParams, { stdio: 'inherit' });
    server.on('close', code => {
        if (code === 8) {
            gulp.log('Error running HTTP server.');
            server = null
        }
    })
}
gulp.task('server', runServer);

gulp.task('build', gulp.parallel('content', 'styles', 'typescript'));
gulp.task('watch', gulp.series(
    gulp.parallel('content', 'styles', 'typescript:watch'),
    gulp.parallel('content:watch', 'styles:watch', 'test:watch', 'server')
));

gulp.task('default', gulp.task('build'));
