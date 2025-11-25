// dows6027.js - Full automation: WARN HTML, XML, index2 update, yearly archive, Telegram post

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Paths
const templatePath = path.join(__dirname, '../dows6027/TEMPLATES/WARNyyyymmdd.txt');
const dataPath = path.join(__dirname, 'dows6027data.json');
const index2Path = path.join(__dirname, 'index2.html');
const archivesPath = path.join(__dirname, 'archives.html');
const outputDir = __dirname;

// Load last processed info
let lastData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
const lastDateUsed = new Date(lastData.last_date_used);

// Dummy new articles - replace with actual fetch/parse logic
async function getNewArticles() {
  return [
    { title: "Middle East Conflict Intensifies", url: "https://www.prophecynewswatch.com/article.cfm?recent_news_id=9053", category: 1, date: "2025-11-02" },
    { title: "False Church Rising", url: "https://www.prophecynewswatch.com/article.cfm?recent_news_id=9054", category: 2, date: "2025-11-03" }
  ].filter(a => new Date(a.date) > lastDateUsed);
}

// Generate WARN HTML
async function generateWarnHTML() {
  let template = fs.readFileSync(templatePath, 'utf-8');
  const newArticles = await getNewArticles();

  // Inject <li> lines into correct category ULs
  const categories = {1: [],2: [],3: [],4: [],5: [],6: [],7: []};
  newArticles.forEach(a => {
    categories[a.category].push(`<li><a href="${a.url}" target="_blank">${a.title}</a></li>`);
  });

  for(let i=1;i<=7;i++){
    template = template.replace(`<ul id="cat-${i}"></ul>`, `<ul id="cat-${i}">\n${categories[i].join('\n')}\n</ul>`);
  }

  // Replace dates
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  template = template.replace('{{START_DATE}}', lastData.last_date_used);
  template = template.replace('{{END_DATE}}', new Date().toLocaleDateString('en-US', options));

  // Save WARN HTML
  const todayStr = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const warnFile = `WARN${todayStr}.html`;
  fs.writeFileSync(path.join(outputDir, warnFile), template);
  console.log(`Generated ${warnFile}`);

  // Update last processed info
  if(newArticles.length>0){
    lastData.last_date_used = newArticles[newArticles.length-1].date;
    lastData.last_URL_processed = newArticles[newArticles.length-1].url;
    fs.writeFileSync(dataPath, JSON.stringify(lastData, null,2));
  }

  return { warnFile, newArticles };
}

// Update index2.html automatically
function updateIndex2(warnFile, newArticles) {
  let indexHtml = fs.readFileSync(index2Path, 'utf-8');

  // Inject new WARN into the top of the list
  const todayStr = new Date().toISOString().slice(0,10);
  const newEntry = `<li><a href="${warnFile}" target="_blank">DOWS6027 Warnings - ${todayStr}</a></li>\n`;
  // Example: find <ul id="warnings-list"></ul> or append at the top
  indexHtml = indexHtml.replace('<ul id="warnings-list"></ul>', `<ul id="warnings-list">\n${newEntry}</ul>`);
  fs.writeFileSync(index2Path, indexHtml);
  console.log("index2.html updated");
}

// Yearly archive on Jan 1
function archiveIndex2() {
  const today = new Date();
  if(today.getMonth()===0 && today.getDate()===1){ // Jan 1
    let indexHtml = fs.readFileSync(index2Path, 'utf-8');
    let archivesHtml = fs.existsSync(archivesPath) ? fs.readFileSync(archivesPath, 'utf-8') : '';
    const year = today.getFullYear()-1;
    const archiveSection = `\n<h2>Archive ${year}</h2>\n${indexHtml}\n`;
    archivesHtml += archiveSection;
    fs.writeFileSync(archivesPath, archivesHtml);
    console.log(`Archived previous year to archives.html under ${year}`);
    // Optionally clear index2.html entries for new year
    fs.writeFileSync(index2Path, '<ul id="warnings-list"></ul>');
  }
}

// Dummy Telegram post function (replace with bot API)
async function postToTelegram(warnFile) {
  console.log(`Posting ${warnFile} to Telegram group...`);
  // Example: call Telegram bot API with fetch
}

// --- Main Runner ---
async function run() {
  const { warnFile, newArticles } = await generateWarnHTML();
  if(newArticles.length>0){
    updateIndex2(warnFile, newArticles);
    archiveIndex2();
    await postToTelegram(warnFile);
  } else {
    console.log("No new articles found.");
  }
}

run();
