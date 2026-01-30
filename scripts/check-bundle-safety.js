#!/usr/bin/env node
/**
 * Pre-build safety check for iOS EAS builds
 * 
 * Scans for patterns that will cause iOS release builds to fail.
 * The Hermes compiler cannot parse:
 * - Dynamic imports with expressions: import(path.join(...))
 * - Bundler pragmas: @vite-ignore, webpackIgnore
 * - Generator-based dynamic imports: yield import(...)
 * 
 * Usage:
 *   node scripts/check-bundle-safety.js
 *   
 * Exit codes:
 *   0 - All checks passed
 *   1 - Dangerous patterns found (run fix-better-auth.js)
 */

const fs = require('fs');
const path = require('path');

// Patterns that break Hermes/iOS builds
const DANGEROUS_PATTERNS = [
    { 
        pattern: /import\s*\(\s*\/\*\s*webpackIgnore/g, 
        description: 'webpackIgnore in dynamic import',
    },
    { 
        pattern: /import\s*\(\s*\/\*\s*@vite-ignore/g, 
        description: '@vite-ignore in dynamic import',
    },
    { 
        pattern: /import\s*\([^)]*path\.join\s*\(/g, 
        description: 'import() with path.join()',
    },
    { 
        pattern: /import\s*\(\s*`[^`]*\$\{/g, 
        description: 'import() with template literal',
    },
    { 
        pattern: /yield\s+import\s*\(/g, 
        description: 'yield import()',
    },
];

let issues = [];

function scanFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const relativePath = path.relative(process.cwd(), filePath);
        
        for (const { pattern, description } of DANGEROUS_PATTERNS) {
            const matches = content.match(pattern);
            if (matches) {
                issues.push({
                    file: relativePath,
                    pattern: description,
                    count: matches.length,
                    sample: matches[0].substring(0, 80),
                });
            }
        }
    } catch (e) {
        // Skip unreadable files
    }
}

function scanDirectory(dir) {
    if (!fs.existsSync(dir)) return;
    
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
                scanDirectory(fullPath);
            } else if (entry.isFile() && /\.(js|mjs|cjs)$/.test(entry.name)) {
                scanFile(fullPath);
            }
        }
    } catch (e) {
        // Skip unreadable directories
    }
}

function main() {
    console.log('🔍 iOS Bundle Safety Check\n');
    
    const betterAuthDist = path.join(process.cwd(), 'node_modules', 'better-auth', 'dist');
    
    if (!fs.existsSync(betterAuthDist)) {
        console.log('⚠️  better-auth not installed - skipping check\n');
        process.exit(0);
    }
    
    console.log('Scanning better-auth for iOS-incompatible patterns...\n');
    scanDirectory(betterAuthDist);
    
    if (issues.length > 0) {
        console.log('❌ FOUND iOS-INCOMPATIBLE PATTERNS:\n');
        
        for (const issue of issues) {
            console.log(`  ${issue.file}`);
            console.log(`    └─ ${issue.pattern} (${issue.count}x)`);
            console.log(`       "${issue.sample}..."\n`);
        }
        
        console.log('='.repeat(60));
        console.log('\n⚠️  These patterns will cause iOS release builds to fail!');
        console.log('\nTo fix, run: node scripts/fix-better-auth.js');
        console.log('Then re-run this check to verify.\n');
        
        process.exit(1);
    }
    
    console.log('✅ No iOS-incompatible patterns found!\n');
    console.log('📱 Ready for iOS EAS build.\n');
    process.exit(0);
}

main();
