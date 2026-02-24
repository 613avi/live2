const puppeteer = require('puppeteer');
const fs = require('fs');

const TARGET_URL = 'https://live.chatr.vip/7017383';

async function scrape() {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Collect CSS and JS from network
    const collectedCSS = [];
    const collectedJS = [];
    
    page.on('response', async (response) => {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';
        
        if (contentType.includes('text/css') || url.endsWith('.css')) {
            try {
                const css = await response.text();
                collectedCSS.push({ url, css });
            } catch (e) {}
        }
        
        if (contentType.includes('javascript') || url.endsWith('.js')) {
            try {
                const js = await response.text();
                collectedJS.push({ url, js });
            } catch (e) {}
        }
    });

    console.log('Loading page...');
    await page.goto(TARGET_URL, { 
        waitUntil: 'networkidle0',
        timeout: 60000 
    });

    await new Promise(resolve => setTimeout(resolve, 8000));

    console.log('Extracting content...');

    const result = await page.evaluate(() => {
        // Get all style tags
        const styleContents = [];
        document.querySelectorAll('style').forEach(style => {
            styleContents.push(style.textContent);
        });

        // Get ALL script tags (both inline and src references)
        const scripts = [];
        document.querySelectorAll('script').forEach(script => {
            if (script.src) {
                scripts.push({ type: 'src', url: script.src });
            } else if (script.textContent.trim()) {
                scripts.push({ type: 'inline', content: script.textContent });
            }
        });

        // Get body HTML
        const bodyHTML = document.body.innerHTML;
        
        // Get head meta tags
        const metaTags = [];
        document.querySelectorAll('head meta, head link[rel="icon"]').forEach(tag => {
            metaTags.push(tag.outerHTML);
        });

        return { styleContents, bodyHTML, scripts, metaTags };
    });

    // Build CSS
    let combinedCSS = '';
    for (const { url, css } of collectedCSS) {
        const fixedCSS = css.replace(/url\(['"]?(?!data:)(?!http)([^'")]+)['"]?\)/g, (match, path) => {
            try {
                const baseUrl = new URL(url);
                const absoluteUrl = new URL(path, baseUrl).href;
                return `url('${absoluteUrl}')`;
            } catch (e) {
                return match;
            }
        });
        combinedCSS += `/* Source: ${url} */\n${fixedCSS}\n\n`;
    }
    for (const style of result.styleContents) {
        combinedCSS += style + '\n';
    }

    // Build JS includes
    let scriptsHTML = '';
    
    // First add external scripts
    for (const script of result.scripts) {
        if (script.type === 'src') {
            scriptsHTML += `<script src="${script.url}"><\/script>\n`;
        }
    }
    
    // Then inline scripts
    for (const script of result.scripts) {
        if (script.type === 'inline') {
            scriptsHTML += `<script>${script.content}<\/script>\n`;
        }
    }

    // Create final HTML
    const finalHTML = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${result.metaTags.join('\n    ')}
    <title>מגבית פורים - סטטיסטיקות</title>
    <base href="https://live.chatr.vip/">
    <style>
${combinedCSS}
    </style>
</head>
<body>
${result.bodyHTML}

${scriptsHTML}
</body>
</html>`;

    await browser.close();

    fs.writeFileSync('content.html', finalHTML);
    console.log('✅ Scraped successfully at', new Date().toISOString());
    console.log('📊 CSS files:', collectedCSS.length);
    console.log('📊 JS files:', collectedJS.length);
    console.log('📊 Scripts preserved:', result.scripts.length);
}

scrape().catch(err => {
    console.error('❌ Scrape failed:', err);
    process.exit(1);
});
