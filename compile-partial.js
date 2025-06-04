const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

const helpersDir = path.join(__dirname, 'src', 'helpers');
if (fs.existsSync(helpersDir)) {
  fs.readdirSync(helpersDir).forEach((file) => {
    if (file.endsWith('.js')) {
      const name = path.basename(file, '.js');
      const helperFn = require(path.join(helpersDir, file));
      if (typeof helperFn !== 'function') {
        console.warn(`⚠️ Skipping ${file}: not a function`);
        return;
      }
      Handlebars.registerHelper(name, helperFn);
    }
  });
}

function readJson(filepath) {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (err) {
    console.warn(`⚠️ Failed to read context JSON (${filepath}), using empty context.`);
    return {};
  }
}

// Parse args
const args = process.argv.slice(2);
const [partialName, jsonPathOrFlag, ...rest] = args;

if (!partialName) {
  console.error('❌ Usage: node compile-partial.js <partial-name> [context.json] [--jsScripts=\'["a.js"]\']');
  process.exit(1);
}

// Flags
let jsonPath = null;
let jsScripts = [];

for (const arg of [jsonPathOrFlag, ...rest]) {
  if (arg?.startsWith('--jsScripts=')) {
    try {
      jsScripts = JSON.parse(arg.split('=')[1]);
    } catch {
      console.warn('⚠️ Invalid --jsScripts argument. Skipping.');
    }
  } else if (arg && !arg.startsWith('--')) {
    jsonPath = arg;
  }
}

// Paths
const baseDir = __dirname;
const partialsDir = path.join(baseDir, 'src', 'partials');
const cssSrcDir = path.join(baseDir, 'src', 'css');
const jsSrcDir = path.join(baseDir, 'src', 'js');
const outDir = path.join(baseDir, 'src', 'static', 'assets', 'widgets');
const cssOutDir = path.join(outDir, 'css');
const jsOutDir = path.join(outDir, 'js');

// Load partial template
const templatePath = path.join(partialsDir, `${partialName}.hbs`);
if (!fs.existsSync(templatePath)) {
  console.error(`❌ Partial not found: ${templatePath}`);
  process.exit(1);
}

// Register all partials
fs.readdirSync(partialsDir).forEach((file) => {
  if (file.endsWith('.hbs')) {
    const name = path.basename(file, '.hbs');
    const template = fs.readFileSync(path.join(partialsDir, file), 'utf8');
    Handlebars.registerPartial(name, template);
  }
});

const templateSrc = fs.readFileSync(templatePath, 'utf8');
const template = Handlebars.compile(templateSrc);
const context = jsonPath ? readJson(path.resolve(jsonPath)) : {};

let html = template(context);

// 🔽 Inject CSS if exists
const sharedCssFiles = ['typeface-inter-bump.css', 'header-bump.css', 'footer-bump.css'];
const allCssFiles = [...sharedCssFiles, `${partialName}-bump.css`];
const cssTags = [];

fs.mkdirSync(cssOutDir, { recursive: true });

allCssFiles.forEach(cssFile => {
  const srcPath = path.join(cssSrcDir, cssFile);
  const outPath = path.join(cssOutDir, cssFile);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, outPath);
    cssTags.push(`<link rel="stylesheet" href="/assets/widgets/css/${cssFile}">`);
  } else if (cssFile !== `${partialName}-bump.css`) {
    console.warn(`⚠️ Shared CSS not found: ${cssFile}`);
  }
});

if (partialName === 'head-scripts') {
  // Prepend styles
  if (cssTags.length) {
    html = `${html}\n${cssTags.join('\n')}`;
  }
}

// 🔽 Inject JS scripts
if (Array.isArray(jsScripts)) {
  fs.mkdirSync(jsOutDir, { recursive: true });

  const scriptTags = jsScripts.map((jsFile) => {
    const jsSrcPath = path.join(jsSrcDir, jsFile);
    const jsOutPath = path.join(jsOutDir, jsFile);

    if (fs.existsSync(jsSrcPath)) {
      fs.copyFileSync(jsSrcPath, jsOutPath);
      return `<script src="/assets/widgets/js/${jsFile}"></script>`;
    } else {
      console.warn(`⚠️ JS script not found: ${jsSrcPath}`);
      return '';
    }
  }).filter(Boolean).join('\n  ');

  if (partialName === 'head-scripts') {
    if (scriptTags) {
      html = `${html}\n${scriptTags}`;
    }
  }
}

// Output HTML
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${partialName}.html`);
fs.writeFileSync(outFile, html);
