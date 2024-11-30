import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

interface ImportMapping {
  absolutePath: string
  relativePath: string
}

const NODE_BUILT_INS = new Set([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
  'express',
  'mongodb'
])

function loadDependencies(): string[] {
  try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'))
    return [...Object.keys(packageJson.dependencies || {}), ...Object.keys(packageJson.devDependencies || {})]
  } catch (e) {
    console.warn('Could not load package.json, dependency checking will be limited')
    return []
  }
}

function isPackageModule(moduleName: string, dependencies: string[]): boolean {
  return NODE_BUILT_INS.has(moduleName) || dependencies.includes(moduleName)
}

function getPackageName(importPath: string): string {
  // Remove all leading relative paths and src/
  return importPath.replace(/^(?:\.\.\/)*(?:src\/)?/, '').split('/')[0]
}

function convertImportPaths(filePath: string, dependencies: string[]): void {
  const content = fs.readFileSync(filePath, 'utf-8')
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true)

  const importMappings: ImportMapping[] = []

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier
      if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
        const importPath = moduleSpecifier.text

        // Skip scoped packages
        if (importPath.startsWith('@')) {
          return
        }

        const packageName = getPackageName(importPath)

        // If this is a relative or absolute import that should be a package import
        if (isPackageModule(packageName, dependencies)) {
          const remainingPath = importPath.slice(importPath.indexOf(packageName) + packageName.length)
          const properPackageImport = packageName + remainingPath

          if (importPath !== properPackageImport) {
            importMappings.push({
              absolutePath: importPath,
              relativePath: properPackageImport
            })
          }
        }
        // Handle regular absolute to relative path conversions
        else if (!importPath.startsWith('.')) {
          // Remove 'src/' prefix if present
          const cleanPath = importPath.replace(/^src\//, '')

          const relativePath = path.relative(path.dirname(filePath), path.join(process.cwd(), 'src', cleanPath)).replace(/\\/g, '/')

          importMappings.push({
            absolutePath: importPath,
            relativePath: relativePath.startsWith('.') ? relativePath : './' + relativePath
          })
        }
        // Handle relative paths that include src/
        else if (importPath.includes('src/')) {
          const parts = importPath.split('src/')
          const cleanPath = parts[1] // Get everything after 'src/'

          const relativePath = path.relative(path.dirname(filePath), path.join(process.cwd(), 'src', cleanPath)).replace(/\\/g, '/')

          importMappings.push({
            absolutePath: importPath,
            relativePath: relativePath.startsWith('.') ? relativePath : './' + relativePath
          })
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  let newContent = content
  importMappings.reverse().forEach(mapping => {
    const regex = new RegExp(`from ['"]${mapping.absolutePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`)
    newContent = newContent.replace(regex, `from '${mapping.relativePath}'`)
  })

  if (content !== newContent) {
    console.log(`Updated imports in: ${filePath}`)
    importMappings.forEach(mapping => {
      console.log(`  ${mapping.absolutePath} → ${mapping.relativePath}`)
    })
    fs.writeFileSync(filePath, newContent)
  }
}

function processDirectory(dir: string, dependencies: string[]): void {
  const files = fs.readdirSync(dir)

  files.forEach(file => {
    const fullPath = path.join(dir, file)
    const stat = fs.statSync(fullPath)

    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== 'dist') {
        processDirectory(fullPath, dependencies)
      }
    } else if (file.match(/\.(ts|js)x?$/)) {
      convertImportPaths(fullPath, dependencies)
    }
  })
}

const projectRoot = process.cwd()
const srcDir = path.join(projectRoot, 'src')
const dependencies = loadDependencies()

console.log('Starting import path conversion...')
console.log(`Found ${dependencies.length} dependencies to check against`)
processDirectory(srcDir, dependencies)
console.log('Conversion complete!')
