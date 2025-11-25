// dows6027.js
// Main DOWS6027 automation: generate WARN HTML and XML feed

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// --- Config paths ---
const templatePath = path.join(__dirname, '../dows6027/TEMPLATES/WARNyyyymmdd.txt');
const dataPath = path.join(__dirname, 'dows6027data.json');
const outputDir = __dirname;

// --- Load last processed info ---
let lastData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
const lastDateUsed = new Date(lastData.last_date_used);
const lastURLProcessed = lastData.last_URL_processed;

// --- Fetch new articles from Prophecy News Watch ---
// Replace this with actual HTML parsing logic
async function getNewArticles() {
  // Dummy example: should be replaced with fetch + parse from website
  return [
    { title: "Middle East Conflict Intensifies", url: "https://www.prophecynewswatch.com/article.cfm?recent_news_id=9053", category: 1, date: "2025-11-02" },
    { title: "False Church Rising", url: "https://www.prophecynewswatch.com/article.cfm?recent_news_id=9054", category: 2, date: "2025-11-03" }
  ].filter(a => new Date(a.date) > lastDateUsed);
}

// --- Generate WARN HTML ---
async function generateWarnHTML() {
  let template = fs.readFileSync(templatePath, 'utf-8');
  const newArticles = await getNewArticles();

  // Sort articles into categories
  const categories = {1: [],2: [],3: [],4: [],5: [],6: [],7: []};
  newArticles.forEach(a => {
    categories[a.category].push(`<li><a href="${a.url}" target="_blank">${a.title}</a></li>`);
  });

  // Inject <li> entries into template
  for (let i = 1; i <= 7; i++) {
    template = template.replace(`<ul id="cat-${i}"></ul>`, `<ul id="cat-${i}">\n${categories[i].join('\n')}\n</ul>`);
  }

  // Replace dates in <h1>
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  const startDate = lastData.last_date_used;
  const endDate = new Date().toLocaleDateString('en-US', options);
  template = template.replace('{{START_DATE}}', startDate);
  template = template.replace('{{END_DATE}}', endDate);

  // Save new WARN HTML
  const todayStr = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const filename = `WARN${todayStr}.html`;
  const filepath = path.join(outputDir, filename);
  fs.writeFileSync(filepath, template);
  console.log(`Generated ${filename}`);

  // Update last processed info
  if(newArticles.length > 0){
    lastData.last_date_used = newArticles[newArticles.length-1].date;
    lastData.last_URL_processed = newArticles[newArticles.length-1].url;
    fs.writeFileSync(dataPath, JSON.stringify(lastData, null, 2));
  }

  return { filename, newArticles };
}

// --- Generate XML Feed ---
async function generateXML(newArticles) {
  const todayStr = new Date().toISOString().slice(0,10);
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<feed>\n  <title>DOWS6027 Warnings</title>\n  <updated>${todayStr}T00:00:00Z</updated>\n`;

  newArticles.forEach(a => {
    xml += `  <entry>\n    <title>${a.title}</title>\n    <link href="${a.url}"/>\n    <updated>${a.date}</updated>\n  </entry>\n`;
  });

  xml += `</feed>`;
  const xmlPath = path.join(outputDir, 'dows6027.xml');
  fs.writeFileSync(xmlPath, xml);
  console.log(`Generated dows6027.xml`);
}

// --- Main Runner ---
async function run() {
  const { filename, newArticles } = await generateWarnHTML();
  if(newArticles.length>0){
    await generateXML(newArticles);
  } else {
    console.log("No new articles found. XML not updated.");
  }
}

run();
