<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Space+Grotesk:wght@300;400;500;600;700&display=swap');

  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{
    --neon:#00FF88;--neon-dim:rgba(0,255,136,0.15);--neon-glow:rgba(0,255,136,0.4);
    --bg:#050505;--surface:rgba(12,16,14,0.95);--border:rgba(0,255,136,0.12);
    --border-bright:rgba(0,255,136,0.3);--text-primary:#E8F5EE;--text-muted:#6B8A76;
    --grid:rgba(0,255,136,0.04);--amber:#F5A623;--red:#FF4444;
  }
  body{background:var(--bg);color:var(--text-primary);font-family:'Space Grotesk',sans-serif;overflow-x:hidden}

  /* SECTION */
  .section{position:relative;padding:100px 0 120px;overflow:hidden;min-height:100vh}

  /* Background */
  .bg-grid{position:absolute;inset:0;background-image:linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);background-size:40px 40px;pointer-events:none}
  .bg-scan{position:absolute;inset:0;background:linear-gradient(to bottom,transparent 0%,rgba(0,255,136,0.02) 50%,transparent 100%);animation:scan 8s linear infinite;pointer-events:none}
  @keyframes scan{0%{transform:translateY(-100%)}100%{transform:translateY(100%)}}
  
  .orb{position:absolute;border-radius:50%;pointer-events:none;animation:orb-pulse 4s ease-in-out infinite}
  .orb-1{width:600px;height:600px;left:-200px;top:-100px;background:radial-gradient(circle,rgba(0,255,136,0.04) 0%,transparent 70%)}
  .orb-2{width:400px;height:400px;right:-100px;bottom:0;background:radial-gradient(circle,rgba(0,255,136,0.03) 0%,transparent 70%);animation-delay:-2s}
  @keyframes orb-pulse{0%,100%{opacity:0.5;transform:scale(1)}50%{opacity:1;transform:scale(1.05)}}

  /* Particles */
  .particles{position:absolute;inset:0;pointer-events:none;overflow:hidden}
  .particle{position:absolute;width:2px;height:2px;background:var(--neon);border-radius:50%;animation:float-up linear infinite;opacity:0}
  @keyframes float-up{0%{opacity:0;transform:translateY(100px)}10%{opacity:0.6}90%{opacity:0.2}100%{opacity:0;transform:translateY(-200px)}}

  /* Layout */
  .container{max-width:1280px;margin:0 auto;padding:0 40px;position:relative;z-index:2}
  .header{text-align:center;margin-bottom:80px}
  
  .eyebrow{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.2em;color:var(--neon);text-transform:uppercase;margin-bottom:20px;display:flex;align-items:center;justify-content:center;gap:12px}
  .eyebrow::before,.eyebrow::after{content:'';width:40px;height:1px;background:linear-gradient(to right,transparent,var(--neon))}
  .eyebrow::after{background:linear-gradient(to left,transparent,var(--neon))}

  .headline{font-size:clamp(32px,4vw,56px);font-weight:600;line-height:1.1;letter-spacing:-0.02em;margin-bottom:20px;background:linear-gradient(135deg,#E8F5EE 0%,#00FF88 50%,#9EFFD4 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
  .subheadline{font-size:17px;color:var(--text-muted);max-width:640px;margin:0 auto;line-height:1.7;font-weight:400}

  /* Grid layout */
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:start}
  @media(max-width:900px){.grid{grid-template-columns:1fr}}

  /* Simulation Cards */
  .cards-col{display:flex;flex-direction:column;gap:16px}

  .sim-card{background:rgba(8,14,11,0.9);border:1px solid var(--border);border-radius:12px;padding:24px;cursor:pointer;transition:all 0.3s ease;position:relative;overflow:hidden}
  .sim-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--neon);transform:scaleY(0);transform-origin:bottom;transition:transform 0.3s ease}
  .sim-card:hover{border-color:var(--border-bright);background:rgba(0,255,136,0.04)}
  .sim-card:hover::before{transform:scaleY(1)}

  .card-header{display:flex;align-items:center;gap:12px;margin-bottom:10px}
  .card-icon{width:32px;height:32px;border:1px solid var(--border-bright);border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .card-icon svg{width:16px;height:16px;color:var(--neon)}
  .card-title{font-size:14px;font-weight:600;color:var(--text-primary);letter-spacing:0.02em}
  .card-desc{font-size:13px;color:var(--text-muted);line-height:1.6;margin-bottom:0;transition:all 0.3s ease}
  .card-expand{max-height:0;overflow:hidden;transition:max-height 0.4s ease,opacity 0.3s ease;opacity:0}
  .sim-card:hover .card-expand{max-height:200px;opacity:1}
  .expand-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px;padding-top:14px;border-top:1px solid var(--border)}
  .expand-item{background:rgba(0,255,136,0.05);border-radius:6px;padding:10px 12px}
  .expand-label{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--neon);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px}
  .expand-value{font-size:12px;color:var(--text-primary)}

  /* Pulse dot */
  .pulse-dot{width:6px;height:6px;border-radius:50%;background:var(--neon);flex-shrink:0;position:relative}
  .pulse-dot::after{content:'';position:absolute;inset:-3px;border-radius:50%;background:var(--neon);opacity:0.3;animation:ring-pulse 2s ease-out infinite}
  @keyframes ring-pulse{0%{transform:scale(1);opacity:0.3}100%{transform:scale(2.5);opacity:0}}

  /* RIGHT PANEL */
  .panel-col{position:sticky;top:40px}

  .panel{background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow:hidden}

  /* Terminal */
  .terminal{background:#020905;border-bottom:1px solid var(--border);padding:20px 24px}
  .terminal-bar{display:flex;align-items:center;gap:8px;margin-bottom:16px}
  .t-dot{width:10px;height:10px;border-radius:50%}
  .t-dot-r{background:#FF5F56}
  .t-dot-y{background:#FFBD2E}
  .t-dot-g{background:#27C93F}
  .terminal-title{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text-muted);margin-left:8px;letter-spacing:0.05em}

  .terminal-body{font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.8}
  .t-line{display:flex;align-items:baseline;gap:8px;margin-bottom:2px;opacity:0;animation:fade-in 0.3s ease forwards}
  @keyframes fade-in{to{opacity:1}}
  .t-prompt{color:var(--neon);flex-shrink:0}
  .t-key{color:#6BFFA8;min-width:180px}
  .t-val{color:#E8F5EE;font-weight:500}
  .t-status{color:var(--neon)}
  .t-muted{color:var(--text-muted)}
  .t-amber{color:var(--amber)}
  .t-cursor{display:inline-block;width:8px;height:14px;background:var(--neon);animation:blink 1s step-end infinite;vertical-align:text-bottom;margin-left:2px}
  @keyframes blink{50%{opacity:0}}

  /* Metrics */
  .metrics-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border);border-bottom:1px solid var(--border)}
  .metric{background:rgba(5,10,8,0.95);padding:16px 20px}
  .metric-label{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.15em;margin-bottom:6px}
  .metric-val{font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:700;color:var(--text-primary);line-height:1}
  .metric-unit{font-size:11px;color:var(--neon);margin-left:2px}
  .metric-delta{font-size:10px;color:var(--neon);margin-top:4px}

  /* Pipeline */
  .pipeline{padding:20px 24px}
  .pipeline-title{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.15em;margin-bottom:16px}
  
  .pipeline-nodes{display:flex;align-items:center;gap:0;overflow-x:auto;padding-bottom:4px}
  .pipe-node{flex-shrink:0;position:relative}
  .pipe-node-inner{background:rgba(0,255,136,0.06);border:1px solid var(--border);border-radius:8px;padding:8px 12px;text-align:center;min-width:90px;position:relative;overflow:hidden;transition:all 0.3s ease}
  .pipe-node-inner::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(0,255,136,0.15) 0%,transparent 60%);opacity:0;transition:opacity 0.3s ease}
  .pipe-node.active .pipe-node-inner{border-color:var(--neon);background:rgba(0,255,136,0.1)}
  .pipe-node.active .pipe-node-inner::before{opacity:1}
  .pipe-node-num{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--neon);margin-bottom:4px}
  .pipe-node-label{font-size:10px;color:var(--text-primary);font-weight:500;line-height:1.3}

  .pipe-connector{width:20px;flex-shrink:0;position:relative;height:2px;margin:0 -1px;align-self:center;top:-6px}
  .pipe-connector-line{height:2px;background:var(--border);border-radius:1px;position:relative;overflow:hidden}
  .pipe-connector-flow{position:absolute;top:0;left:-100%;width:100%;height:100%;background:linear-gradient(to right,transparent,var(--neon),transparent);animation:flow 2s linear infinite}
  @keyframes flow{to{left:100%}}

  /* Graph */
  .graph-section{border-top:1px solid var(--border);padding:20px 24px}
  .graph-canvas{width:100%;height:180px;position:relative;overflow:hidden}
  canvas{display:block}

  /* Status bar */
  .status-bar{background:#020905;border-top:1px solid var(--border);padding:10px 24px;display:flex;align-items:center;gap:16px}
  .status-dot{width:6px;height:6px;border-radius:50%;background:var(--neon);animation:ring-pulse 1.5s ease-out infinite}
  .status-text{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--neon)}
  .status-right{margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-muted)}

  /* Scrollbar */
  ::-webkit-scrollbar{height:3px;width:3px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:var(--border-bright);border-radius:2px}
</style>
</head>
<body>

<section class="section">
  <div class="bg-grid"></div>
  <div class="bg-scan"></div>
  <div class="orb orb-1"></div>
  <div class="orb orb-2"></div>
  <div class="particles" id="particles"></div>

  <div class="container">
    <!-- Header -->
    <div class="header">
      <div class="eyebrow">VetIOS Intelligence Infrastructure</div>
      <h2 class="headline">Training Veterinary Intelligence at Scale</h2>
      <p class="subheadline">VetIOS continuously simulates clinical reasoning, patient outcomes, diagnostic pathways, and real-world veterinary workflows to improve intelligence over time.</p>
    </div>

    <!-- Two column grid -->
    <div class="grid">

      <!-- LEFT: Sim cards -->
      <div class="cards-col">

        <div class="sim-card">
          <div class="card-header">
            <div class="card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/></svg>
            </div>
            <div>
              <div class="card-title">Clinical Simulations</div>
              <div style="display:flex;align-items:center;gap:6px;margin-top:3px"><div class="pulse-dot"></div><span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--neon)">RUNNING</span></div>
            </div>
          </div>
          <p class="card-desc">VetIOS runs thousands of synthetic veterinary cases to stress-test diagnostic reasoning across species, symptom combinations, and disease states.</p>
          <div class="card-expand">
            <div class="expand-row">
              <div class="expand-item"><div class="expand-label">Why it matters</div><div class="expand-value">Prevents reasoning collapse on edge-case presentations</div></div>
              <div class="expand-item"><div class="expand-label">Intelligence gain</div><div class="expand-value">Differential accuracy improves +2.1% per 10K simulations</div></div>
              <div class="expand-item"><div class="expand-label">Confidence impact</div><div class="expand-value">High — directly trains diagnostic confidence scoring</div></div>
              <div class="expand-item"><div class="expand-label">Volume / day</div><div class="expand-value" id="sim-count">18,420 cases</div></div>
            </div>
          </div>
        </div>

        <div class="sim-card">
          <div class="card-header">
            <div class="card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>
            </div>
            <div>
              <div class="card-title">Outcome Learning</div>
              <div style="display:flex;align-items:center;gap:6px;margin-top:3px"><div class="pulse-dot"></div><span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--neon)">ACTIVE</span></div>
            </div>
          </div>
          <p class="card-desc">VetIOS retrains confidence pathways using verified outcomes and clinician corrections, closing the feedback loop between prediction and reality.</p>
          <div class="card-expand">
            <div class="expand-row">
              <div class="expand-item"><div class="expand-label">Why it matters</div><div class="expand-value">Prevents confidence drift from unverified predictions</div></div>
              <div class="expand-item"><div class="expand-label">Intelligence gain</div><div class="expand-value">Corrected pathways propagate across related diagnoses</div></div>
              <div class="expand-item"><div class="expand-label">Confidence impact</div><div class="expand-value">Critical — source of ground truth for the model</div></div>
              <div class="expand-item"><div class="expand-label">Correction rate</div><div class="expand-value">3.2% of pathways updated daily</div></div>
            </div>
          </div>
        </div>

        <div class="sim-card">
          <div class="card-header">
            <div class="card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
            </div>
            <div>
              <div class="card-title">Agent Interaction Modeling</div>
              <div style="display:flex;align-items:center;gap:6px;margin-top:3px"><div class="pulse-dot"></div><span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--neon)">MULTI-AGENT</span></div>
            </div>
          </div>
          <p class="card-desc">Multiple intelligence agents simulate reasoning, disagreement, escalation, and consensus to surface edge cases and strengthen diagnostic robustness.</p>
          <div class="card-expand">
            <div class="expand-row">
              <div class="expand-item"><div class="expand-label">Why it matters</div><div class="expand-value">Exposes blind spots single-agent reasoning misses</div></div>
              <div class="expand-item"><div class="expand-label">Intelligence gain</div><div class="expand-value">Disagreement events become high-priority training signals</div></div>
              <div class="expand-item"><div class="expand-label">Confidence impact</div><div class="expand-value">Consensus rate directly tied to output confidence</div></div>
              <div class="expand-item"><div class="expand-label">Active agents</div><div class="expand-value">7 specialized diagnostic agents</div></div>
            </div>
          </div>
        </div>

        <div class="sim-card">
          <div class="card-header">
            <div class="card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v4M12 11l-5.5 6M12 11l5.5 6"/></svg>
            </div>
            <div>
              <div class="card-title">Veterinary Graph Training</div>
              <div style="display:flex;align-items:center;gap:6px;margin-top:3px"><div class="pulse-dot"></div><span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--neon)">TRAVERSING</span></div>
            </div>
          </div>
          <p class="card-desc">Knowledge graph traversal continuously improves disease relationships and symptom pathways, expanding the diagnostic map across species and conditions.</p>
          <div class="card-expand">
            <div class="expand-row">
              <div class="expand-item"><div class="expand-label">Why it matters</div><div class="expand-value">Graph density directly correlates with recall accuracy</div></div>
              <div class="expand-item"><div class="expand-label">Intelligence gain</div><div class="expand-value">New node relationships discovered through traversal</div></div>
              <div class="expand-item"><div class="expand-label">Confidence impact</div><div class="expand-value">Strong — underpins multi-hop diagnostic reasoning</div></div>
              <div class="expand-item"><div class="expand-label">Graph expansion</div><div class="expand-value">+1.8% knowledge coverage this cycle</div></div>
            </div>
          </div>
        </div>

      </div>

      <!-- RIGHT: Training panel -->
      <div class="panel-col">
        <div class="panel">

          <!-- Terminal -->
          <div class="terminal">
            <div class="terminal-bar">
              <div class="t-dot t-dot-r"></div>
              <div class="t-dot t-dot-y"></div>
              <div class="t-dot t-dot-g"></div>
              <span class="terminal-title">vetios-runtime — training-loop v4.2.1</span>
            </div>
            <div class="terminal-body" id="terminal-body">
            </div>
          </div>

          <!-- Metrics grid -->
          <div class="metrics-grid">
            <div class="metric">
              <div class="metric-label">Cases / Day</div>
              <div class="metric-val"><span id="m1">18,420</span></div>
              <div class="metric-delta">↑ 4.2% vs yesterday</div>
            </div>
            <div class="metric">
              <div class="metric-label">Graph Nodes</div>
              <div class="metric-val"><span id="m2">2.8</span><span class="metric-unit">M</span></div>
              <div class="metric-delta">↑ +1.8% this cycle</div>
            </div>
            <div class="metric">
              <div class="metric-label">Model Confidence</div>
              <div class="metric-val"><span id="m3">94.2</span><span class="metric-unit">%</span></div>
              <div class="metric-delta">Stable ±0.1%</div>
            </div>
            <div class="metric">
              <div class="metric-label">Inference Drift</div>
              <div class="metric-val" style="font-size:14px;padding-top:4px;color:var(--neon)">STABLE</div>
              <div class="metric-delta">Within threshold</div>
            </div>
            <div class="metric">
              <div class="metric-label">Consensus Rate</div>
              <div class="metric-val"><span id="m4">91.7</span><span class="metric-unit">%</span></div>
              <div class="metric-delta">↑ +0.3% today</div>
            </div>
            <div class="metric">
              <div class="metric-label">Telemetry</div>
              <div class="metric-val"><span id="m5">847</span><span class="metric-unit">k</span></div>
              <div class="metric-delta">signals / hour</div>
            </div>
          </div>

          <!-- Pipeline -->
          <div class="pipeline">
            <div class="pipeline-title">Active Training Pipeline</div>
            <div class="pipeline-nodes" id="pipeline">
              <!-- injected by JS -->
            </div>
          </div>

          <!-- Graph canvas -->
          <div class="graph-section">
            <div class="pipeline-title">Knowledge Graph Traversal — Live</div>
            <div class="graph-canvas">
              <canvas id="graphCanvas"></canvas>
            </div>
          </div>

          <!-- Status bar -->
          <div class="status-bar">
            <div class="status-dot"></div>
            <span class="status-text">VetIOS Runtime Training...</span>
            <span class="status-right" id="clock">--:--:-- UTC</span>
          </div>

        </div>
      </div>

    </div>
  </div>
</section>

<script>
// ── Particles ───────────────────────────────────────────────────────────────
const pContainer = document.getElementById('particles');
for(let i=0;i<25;i++){
  const p = document.createElement('div');
  p.className = 'particle';
  p.style.left = Math.random()*100 + '%';
  p.style.bottom = Math.random()*100 + '%';
  p.style.animationDuration = (6+Math.random()*10) + 's';
  p.style.animationDelay = (Math.random()*8) + 's';
  p.style.width = p.style.height = (Math.random()>0.7?3:1.5)+'px';
  pContainer.appendChild(p);
}

// ── Terminal typing ──────────────────────────────────────────────────────────
const lines = [
  ['prompt','status','VetIOS Runtime Training...',''],
  ['prompt','key','Model Version:','t-val','v4.2.1-stable'],
  ['prompt','key','Training Mode:','t-status','continuous'],
  ['prompt','key','Cases Simulated:','t-val','18,420'],
  ['prompt','key','Graph Traversals:','t-val','2,847,391'],
  ['prompt','key','Model Confidence:','t-val','94.2%'],
  ['prompt','key','Inference Drift:','t-status','stable'],
  ['prompt','key','Knowledge Expansion:','t-amber','+1.8%'],
  ['prompt','key','Agent Consensus:','t-val','91.7%'],
  ['prompt','key','Telemetry Signals:','t-val','847k/hr'],
  ['prompt','muted','--- cycle 4821 complete ---',''],
  ['prompt','status','Awaiting next batch...','cursor'],
];

const tbody = document.getElementById('terminal-body');
let li = 0;
function addLine(){
  if(li>=lines.length)return;
  const row = lines[li++];
  const div = document.createElement('div');
  div.className = 't-line';
  div.style.animationDelay = '0s';

  if(row[1]==='status'){
    div.innerHTML = `<span class="t-prompt">▶</span><span class="t-status">${row[2]}</span>`;
  } else if(row[1]==='muted'){
    div.innerHTML = `<span class="t-prompt" style="opacity:0.3">─</span><span class="t-muted">${row[2]}</span>`;
  } else if(row[1]==='key'){
    const valClass = row[3]||'t-val';
    const cursor = row[4]==='cursor'?'<span class="t-cursor"></span>':'';
    div.innerHTML = `<span class="t-prompt">$</span><span class="t-key">${row[2]}</span><span class="${valClass}">${row[4]||row[3]}${cursor}</span>`;
  }

  tbody.appendChild(div);
  tbody.scrollTop = tbody.scrollHeight;

  if(li<lines.length) setTimeout(addLine, 180+Math.random()*120);
}
setTimeout(addLine, 600);

// ── Pipeline ─────────────────────────────────────────────────────────────────
const pipelineNodes = ['Case Intake','Symptom Parsing','Knowledge Graph','Differential Ranking','Validation Layer','Feedback Memory','Model Adaptation'];
const pipeEl = document.getElementById('pipeline');

pipelineNodes.forEach((label,i)=>{
  const node = document.createElement('div');
  node.className = 'pipe-node';
  node.id = `pnode-${i}`;
  node.innerHTML = `<div class="pipe-node-inner"><div class="pipe-node-num">${String(i+1).padStart(2,'0')}</div><div class="pipe-node-label">${label}</div></div>`;
  pipeEl.appendChild(node);

  if(i<pipelineNodes.length-1){
    const conn = document.createElement('div');
    conn.className = 'pipe-connector';
    conn.innerHTML = `<div class="pipe-connector-line"><div class="pipe-connector-flow" style="animation-delay:${i*0.28}s"></div></div>`;
    pipeEl.appendChild(conn);
  }
});

// Animate active node
let activeNode = 0;
setInterval(()=>{
  document.querySelectorAll('.pipe-node').forEach((n,i)=>{
    n.classList.toggle('active', i===activeNode);
  });
  activeNode = (activeNode+1)%pipelineNodes.length;
}, 900);

// ── Graph canvas ──────────────────────────────────────────────────────────────
const canvas = document.getElementById('graphCanvas');
function resizeCanvas(){
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = 180;
}
resizeCanvas();

const ctx = canvas.getContext('2d');
const NEON = '#00FF88';
const NEON_DIM = 'rgba(0,255,136,0.2)';

// Nodes
const nodes = [];
const W = () => canvas.width;
const H = 180;

function createNodes(){
  nodes.length = 0;
  const count = Math.floor(W()/35);
  for(let i=0;i<count;i++){
    nodes.push({
      x: 20 + Math.random()*(W()-40),
      y: 20 + Math.random()*(H-40),
      vx: (Math.random()-0.5)*0.3,
      vy: (Math.random()-0.5)*0.3,
      r: 2 + Math.random()*2,
      pulse: Math.random()*Math.PI*2,
      active: Math.random()>0.7,
    });
  }
}
createNodes();

// Edges: connect nearby nodes
function getEdges(){
  const edges = [];
  const thresh = W()*0.22;
  for(let i=0;i<nodes.length;i++){
    for(let j=i+1;j<nodes.length;j++){
      const d = Math.hypot(nodes[i].x-nodes[j].x, nodes[i].y-nodes[j].y);
      if(d<thresh) edges.push([i,j,d,thresh]);
    }
  }
  return edges;
}

// Traversal animation
let traveler = null;
function spawnTraveler(){
  if(nodes.length<2) return;
  const i = Math.floor(Math.random()*nodes.length);
  const edges = getEdges();
  const connected = edges.filter(e=>e[0]===i||e[1]===i);
  if(!connected.length) return;
  const edge = connected[Math.floor(Math.random()*connected.length)];
  const target = edge[0]===i?edge[1]:edge[0];
  traveler = {from:i, to:target, t:0, speed:0.015+Math.random()*0.015};
}

let frame = 0;
function drawGraph(){
  ctx.clearRect(0,0,W(),H);
  frame++;

  const edges = getEdges();

  // Draw edges
  edges.forEach(([i,j,d,thresh])=>{
    const alpha = (1-(d/thresh))*0.35;
    ctx.strokeStyle = `rgba(0,255,136,${alpha})`;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(nodes[i].x, nodes[i].y);
    ctx.lineTo(nodes[j].x, nodes[j].y);
    ctx.stroke();
  });

  // Move nodes slightly
  nodes.forEach(n=>{
    n.x += n.vx;
    n.y += n.vy;
    if(n.x<10||n.x>W()-10) n.vx *= -1;
    if(n.y<10||n.y>H-10) n.vy *= -1;
    n.pulse += 0.05;
  });

  // Draw nodes
  nodes.forEach((n,i)=>{
    const glow = n.active ? (0.5 + 0.5*Math.sin(n.pulse)) : 0.3;
    // Glow ring
    if(n.active){
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r+4, 0, Math.PI*2);
      ctx.fillStyle = `rgba(0,255,136,${glow*0.15})`;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI*2);
    ctx.fillStyle = n.active ? NEON : 'rgba(0,255,136,0.35)';
    ctx.fill();
  });

  // Draw traveler
  if(traveler){
    traveler.t += traveler.speed;
    if(traveler.t>=1){
      nodes[traveler.to].active = true;
      setTimeout(spawnTraveler, 100);
      traveler = null;
    } else {
      const sx = nodes[traveler.from].x, sy = nodes[traveler.from].y;
      const ex = nodes[traveler.to].x,   ey = nodes[traveler.to].y;
      const tx = sx + (ex-sx)*traveler.t;
      const ty = sy + (ey-sy)*traveler.t;
      ctx.beginPath();
      ctx.arc(tx, ty, 3.5, 0, Math.PI*2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(tx, ty, 7, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(0,255,136,0.3)';
      ctx.fill();
    }
  }

  requestAnimationFrame(drawGraph);
}
drawGraph();
spawnTraveler();
setInterval(spawnTraveler, 1800);

// ── Metrics live update ───────────────────────────────────────────────────────
function animateCount(el, start, end, duration, decimals=0, suffix=''){
  const startTime = performance.now();
  function update(now){
    const t = Math.min((now-startTime)/duration, 1);
    const v = start + (end-start)*t;
    el.textContent = decimals>0 ? v.toFixed(decimals) : Math.round(v).toLocaleString();
    if(t<1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

// Jitter metrics
function jitterMetrics(){
  const m1 = document.getElementById('m1');
  const m3 = document.getElementById('m3');
  const m4 = document.getElementById('m4');
  const m5 = document.getElementById('m5');
  
  const base1 = parseInt(m1.textContent.replace(/,/g,''));
  animateCount(m1, base1, base1+Math.floor(Math.random()*80-20), 800);
  
  const base3 = parseFloat(m3.textContent);
  const new3 = Math.min(99.9, Math.max(90, base3+(Math.random()*0.4-0.2)));
  animateCount(m3, base3*10, new3*10, 600, 1);
  setTimeout(()=>{ m3.textContent = new3.toFixed(1); }, 700);
  
  const base4 = parseFloat(m4.textContent);
  const new4 = Math.min(99, Math.max(85, base4+(Math.random()*0.6-0.2)));
  animateCount(m4, base4*10, new4*10, 600, 1);
  setTimeout(()=>{ m4.textContent = new4.toFixed(1); }, 700);
  
  const base5 = parseInt(m5.textContent.replace(/,/g,''));
  animateCount(m5, base5, base5+Math.floor(Math.random()*40-15), 800);
}
setInterval(jitterMetrics, 2200);

// ── Clock ─────────────────────────────────────────────────────────────────────
function updateClock(){
  const now = new Date();
  const h = String(now.getUTCHours()).padStart(2,'0');
  const m = String(now.getUTCMinutes()).padStart(2,'0');
  const s = String(now.getUTCSeconds()).padStart(2,'0');
  document.getElementById('clock').textContent = `${h}:${m}:${s} UTC`;
}
setInterval(updateClock, 1000);
updateClock();

// Resize canvas on window resize
window.addEventListener('resize', ()=>{
  resizeCanvas();
  createNodes();
});
</script>
</body>
</html>
