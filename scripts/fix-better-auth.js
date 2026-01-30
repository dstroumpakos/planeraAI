#!/usr/bin/env node
// Fix better-auth for React Native/Hermes compatibility
// Patches dynamic imports that break iOS release builds

var fs = require('fs');
var path = require('path');

var BETTER_AUTH_PATH = path.join(process.cwd(), 'node_modules', 'better-auth');
var BETTER_AUTH_DIST = path.join(BETTER_AUTH_PATH, 'dist');

var filesPatched = 0;
var patternsFixed = 0;

// Patterns to find and replace
var PATCHES = [
    {
        name: 'webpackIgnore dynamic import',
        find: /import\s*\(\s*\/\*\s*webpackIgnore[^*]*\*\/[^)]+\)/g,
        replace: 'Promise.resolve({})'
    },
    {
        name: 'vite-ignore dynamic import',
        find: /import\s*\(\s*\/\*\s*@vite-ignore[^*]*\*\/[^)]+\)/g,
        replace: 'Promise.resolve({})'
    },
    {
        name: 'path.join in import',
        find: /import\s*\([^)]*\.path\.join[^)]+\)/g,
        replace: 'Promise.resolve({})'
    },
    {
        name: 'migrationFolder import',
        find: /import\s*\([^)]*migrationFolder[^)]+\)/g,
        replace: 'Promise.resolve({})'
    }
];

function patchFile(filePath) {
    if (!fs.existsSync(filePath)) return false;
    
    var content;
    try {
        content = fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
        return false;
    }
    
    var originalContent = content;
    var relativePath = path.relative(BETTER_AUTH_DIST, filePath);
    
    for (var i = 0; i < PATCHES.length; i++) {
        var patch = PATCHES[i];
        var matches = content.match(patch.find);
        if (matches) {
            console.log('  [' + relativePath + '] Fixing: ' + patch.name + ' (' + matches.length + 'x)');
            content = content.replace(patch.find, patch.replace);
            patternsFixed += matches.length;
        }
    }
    
    if (content !== originalContent) {
        fs.writeFileSync(filePath, content, 'utf-8');
        filesPatched++;
        return true;
    }
    
    return false;
}

function scanAndPatch(dir) {
    if (!fs.existsSync(dir)) return;
    
    var entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
        return;
    }
    
    for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        var fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
            scanAndPatch(fullPath);
        } else if (entry.isFile() && /\.(js|mjs|cjs)$/.test(entry.name)) {
            patchFile(fullPath);
        }
    }
}

function ensureShims() {
    var shimsDir = path.join(process.cwd(), 'shims');
    
    if (!fs.existsSync(shimsDir)) {
        fs.mkdirSync(shimsDir, { recursive: true });
    }
    
    var emptyShim = path.join(shimsDir, 'empty.js');
    if (!fs.existsSync(emptyShim)) {
        fs.writeFileSync(emptyShim, 'module.exports = {};\n');
        console.log('Created shims/empty.js');
    }
}

function main() {
    console.log('Patching better-auth for React Native/Hermes...');
    
    ensureShims();
    
    if (!fs.existsSync(BETTER_AUTH_PATH)) {
        console.log('better-auth not found - skipping');
        return;
    }
    
    console.log('Scanning ' + BETTER_AUTH_DIST);
    
    scanAndPatch(BETTER_AUTH_DIST);
    
    console.log('');
    if (filesPatched > 0) {
        console.log('Patched ' + filesPatched + ' file(s), fixed ' + patternsFixed + ' pattern(s)');
    } else {
        console.log('No patches needed');
    }
}

main();
