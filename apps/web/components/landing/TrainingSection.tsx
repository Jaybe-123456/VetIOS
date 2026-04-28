'use client'
import { useEffect, useRef } from 'react'
export default function TrainingSection() {
  const mounted = useRef(false)
  useEffect(() => {
    if (mounted.current) return
    mounted.current = true
    const script = document.createElement('script')
    script.textContent = `
(function() {
  const pContainer = document.getElementById('particles');
  if (!pContainer) return;
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
  const lines = [
    ['status','VetIOS Runtime Training...'],
    ['kv','Model Version:','t-val','v4.2.1-stable'],
    ['kv','Training Mode:','t-status','continuous'],
    ['kv','Cases Simulated:','t-val','18,420'],
    ['kv','Graph Traversals:','t-val','2,847,391'],
    ['kv','Model Confidence:','t-val','94.2%'],
    ['kv','Inference Drift:','t-status','stable'],
    ['kv','Knowledge Expansion:','t-amber','+1.8%'],
    ['kv','Agent Consensus:','t-val','91.7%'],
    ['kv','Telemetry Signals:','t-val','847k/hr'],
    ['muted','--- cycle 4821 complete ---'],
    ['status','Awaiting next batch...'],
  ];
  const tbody = document.getElementById('terminal-body');
  let li = 0;
  function addLine(){
    if(!tbody||li>=lines.length) return;
    const row=lines[li++];
    const div=document.createElement('div');
    div.className='t-line';
    div.style.animationDelay='0s';
    if(row[0]==='status') div.innerHTML='<span class="t-prompt">&#9658;</span><span class="t-status">'+row[1]+'</span>';
    else if(row[0]==='muted') div.innerHTML='<span class="t-prompt" style="opacity:0.3">&#8212;</span><span class="t-muted">'+row[1]+'</span>';
    else if(row[0]==='kv') div.innerHTML='<span class="t-prompt">$</span><span class="t-key">'+row[1]+'</span><span class="'+row[2]+'">'+row[3]+'</span>';
    tbody.appendChild(div);
    tbody.scrollTop=tbody.scrollHeight;
    if(li<lines.length) setTimeout(addLine,180+Math.random()*120);
  }
  setTimeout(addLine,600);
  const pipelineNodes=['Case Intake','Symptom Parsing','Knowledge Graph','Differential Ranking','Validation Layer','Feedback Memory','Model Adaptation'];
  const pipeEl=document.getElementById('pipeline');
  if(pipeEl){
    pipelineNodes.forEach(function(label,i){
      const node=document.createElement('div');
      node.className='pipe-node';
      node.id='pnode-'+i;
      node.innerHTML='<div class="pipe-node-inner"><div class="pipe-node-num">'+String(i+1).padStart(2,'0')+'</div><div class="pipe-node-label">'+label+'</div></div>';
      pipeEl.appendChild(node);
      if(i<pipelineNodes.length-1){
        const conn=document.createElement('div');
        conn.className='pipe-connector';
        conn.innerHTML='<div class="pipe-connector-line"><div class="pipe-connector-flow" style="animation-delay:'+(i*0.28)+'s"></div></div>';
        pipeEl.appendChild(conn);
      }
    });
    let activeNode=0;
    setInterval(function(){
      document.querySelectorAll('.pipe-node').forEach(function(n,i){ n.classList.toggle('active',i===activeNode); });
      activeNode=(activeNode+1)%pipelineNodes.length;
    },900);
  }
  const canvas=document.getElementById('graphCanvas');
  if(canvas){
    function resizeCanvas(){ canvas.width=canvas.parentElement.getBoundingClientRect().width; canvas.height=180; }
    resizeCanvas();
    window.addEventListener('resize',function(){ resizeCanvas(); createNodes(); });
    const ctx=canvas.getContext('2d');
    const nodes=[];
    function createNodes(){
      nodes.length=0;
      const count=Math.floor(canvas.width/35);
      for(let i=0;i<count;i++) nodes.push({x:20+Math.random()*(canvas.width-40),y:20+Math.random()*140,vx:(Math.random()-0.5)*0.3,vy:(Math.random()-0.5)*0.3,r:2+Math.random()*2,pulse:Math.random()*Math.PI*2,active:Math.random()>0.7});
    }
    createNodes();
    function getEdges(){
      const edges=[],thresh=canvas.width*0.22;
      for(let i=0;i<nodes.length;i++) for(let j=i+1;j<nodes.length;j++){const d=Math.hypot(nodes[i].x-nodes[j].x,nodes[i].y-nodes[j].y);if(d<thresh)edges.push([i,j,d,thresh]);}
      return edges;
    }
    let traveler=null;
    function spawnTraveler(){
      if(nodes.length<2)return;
      const edges=getEdges();if(!edges.length)return;
      const e=edges[Math.floor(Math.random()*edges.length)];
      traveler={from:e[0],to:e[1],t:0,speed:0.015+Math.random()*0.015};
    }
    function drawGraph(){
      ctx.clearRect(0,0,canvas.width,canvas.height);
      getEdges().forEach(function(e){ctx.strokeStyle='rgba(0,255,136,'+(1-(e[2]/e[3]))*0.35+')';ctx.lineWidth=0.5;ctx.beginPath();ctx.moveTo(nodes[e[0]].x,nodes[e[0]].y);ctx.lineTo(nodes[e[1]].x,nodes[e[1]].y);ctx.stroke();});
      nodes.forEach(function(n){n.x+=n.vx;n.y+=n.vy;if(n.x<10||n.x>canvas.width-10)n.vx*=-1;if(n.y<10||n.y>170)n.vy*=-1;n.pulse+=0.05;if(n.active){ctx.beginPath();ctx.arc(n.x,n.y,n.r+4,0,Math.PI*2);ctx.fillStyle='rgba(0,255,136,'+(0.5+0.5*Math.sin(n.pulse))*0.15+')';ctx.fill();}ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,Math.PI*2);ctx.fillStyle=n.active?'#00FF88':'rgba(0,255,136,0.35)';ctx.fill();});
      if(traveler){traveler.t+=traveler.speed;if(traveler.t>=1){nodes[traveler.to].active=true;setTimeout(spawnTraveler,100);traveler=null;}else{const sx=nodes[traveler.from].x,sy=nodes[traveler.from].y,ex=nodes[traveler.to].x,ey=nodes[traveler.to].y,tx=sx+(ex-sx)*traveler.t,ty=sy+(ey-sy)*traveler.t;ctx.beginPath();ctx.arc(tx,ty,3.5,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.beginPath();ctx.arc(tx,ty,7,0,Math.PI*2);ctx.fillStyle='rgba(0,255,136,0.3)';ctx.fill();}}
      requestAnimationFrame(drawGraph);
    }
    drawGraph();spawnTraveler();setInterval(spawnTraveler,1800);
  }
  function animateCount(el,start,end,duration,decimals){
    const startTime=performance.now();
    function update(now){const t=Math.min((now-startTime)/duration,1),v=start+(end-start)*t;el.textContent=decimals>0?v.toFixed(decimals):Math.round(v).toLocaleString();if(t<1)requestAnimationFrame(update);}
    requestAnimationFrame(update);
  }
  setInterval(function(){
    const m1=document.getElementById('m1'),m3=document.getElementById('m3'),m4=document.getElementById('m4'),m5=document.getElementById('m5');
    if(m1){const b=parseInt(m1.textContent.replace(/,/g,''));animateCount(m1,b,b+Math.floor(Math.random()*80-20),800,0);}
    if(m3){const b=parseFloat(m3.textContent);const n=Math.min(99.9,Math.max(90,b+(Math.random()*0.4-0.2)));animateCount(m3,b,n,600,1);}
    if(m4){const b=parseFloat(m4.textContent);const n=Math.min(99,Math.max(85,b+(Math.random()*0.6-0.2)));animateCount(m4,b,n,600,1);}
    if(m5){const b=parseInt(m5.textContent.replace(/,/g,''));animateCount(m5,b,b+Math.floor(Math.random()*40-15),800,0);}
  },2200);
  function updateClock(){const now=new Date(),el=document.getElementById('clock');if(el)el.textContent=String(now.getUTCHours()).padStart(2,'0')+':'+String(now.getUTCMinutes()).padStart(2,'0')+':'+String(now.getUTCSeconds()).padStart(2,'0')+' UTC';}
  setInterval(updateClock,1000);updateClock();
})();
`
    document.body.appendChild(script)
    return () => { document.body.removeChild(script) }
  }, [])

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Space+Grotesk:wght@300;400;500;600;700&display=swap');
    .vt-section{position:relative;padding:100px 0 120px;overflow:hidden;background:#050505;font-family:'Space Grotesk',sans-serif;color:#E8F5EE}
    .vt-bg-grid{position:absolute;inset:0;background-image:linear-gradient(rgba(0,255,136,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,136,0.04) 1px,transparent 1px);background-size:40px 40px;pointer-events:none}
    .vt-bg-scan{position:absolute;inset:0;background:linear-gradient(to bottom,transparent 0%,rgba(0,255,136,0.02) 50%,transparent 100%);animation:vt-scan 8s linear infinite;pointer-events:none}
    @keyframes vt-scan{0%{transform:translateY(-100%)}100%{transform:translateY(100%)}}
    .vt-orb{position:absolute;border-radius:50%;pointer-events:none;animation:vt-orb-pulse 4s ease-in-out infinite}
    .vt-orb-1{width:600px;height:600px;left:-200px;top:-100px;background:radial-gradient(circle,rgba(0,255,136,0.04) 0%,transparent 70%)}
    .vt-orb-2{width:400px;height:400px;right:-100px;bottom:0;background:radial-gradient(circle,rgba(0,255,136,0.03) 0%,transparent 70%);animation-delay:-2s}
    @keyframes vt-orb-pulse{0%,100%{opacity:0.5;transform:scale(1)}50%{opacity:1;transform:scale(1.05)}}
    .particles{position:absolute;inset:0;pointer-events:none;overflow:hidden}
    .particle{position:absolute;width:2px;height:2px;background:#00FF88;border-radius:50%;animation:vt-float-up linear infinite;opacity:0}
    @keyframes vt-float-up{0%{opacity:0;transform:translateY(100px)}10%{opacity:0.6}90%{opacity:0.2}100%{opacity:0;transform:translateY(-200px)}}
    .vt-container{max-width:1280px;margin:0 auto;padding:0 40px;position:relative;z-index:2}
    .vt-header{text-align:center;margin-bottom:80px}
    .vt-eyebrow{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.2em;color:#00FF88;text-transform:uppercase;margin-bottom:20px;display:flex;align-items:center;justify-content:center;gap:12px}
    .vt-eyebrow::before,.vt-eyebrow::after{content:'';width:40px;height:1px;background:linear-gradient(to right,transparent,#00FF88)}
    .vt-eyebrow::after{background:linear-gradient(to left,transparent,#00FF88)}
    .vt-headline{font-size:clamp(32px,4vw,56px);font-weight:600;line-height:1.1;letter-spacing:-0.02em;margin-bottom:20px;background:linear-gradient(135deg,#E8F5EE 0%,#00FF88 50%,#9EFFD4 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    .vt-subheadline{font-size:17px;color:#6B8A76;max-width:640px;margin:0 auto;line-height:1.7;font-weight:400}
    .vt-grid{display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:start}
    @media(max-width:900px){.vt-grid{grid-template-columns:1fr}}
    .cards-col{display:flex;flex-direction:column;gap:16px}
    .sim-card{background:rgba(8,14,11,0.9);border:1px solid rgba(0,255,136,0.12);border-radius:12px;padding:24px;cursor:pointer;transition:all 0.3s ease;position:relative;overflow:hidden}
    .sim-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:2px;background:#00FF88;transform:scaleY(0);transform-origin:bottom;transition:transform 0.3s ease}
    .sim-card:hover{border-color:rgba(0,255,136,0.3);background:rgba(0,255,136,0.04)}
    .sim-card:hover::before{transform:scaleY(1)}
    .sim-card:hover .card-expand{max-height:200px;opacity:1}
    .card-header{display:flex;align-items:center;gap:12px;margin-bottom:10px}
    .card-icon{width:32px;height:32px;border:1px solid rgba(0,255,136,0.3);border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#00FF88}
    .card-icon svg{width:16px;height:16px}
    .card-title{font-size:14px;font-weight:600;color:#E8F5EE;letter-spacing:0.02em}
    .card-desc{font-size:13px;color:#6B8A76;line-height:1.6}
    .card-expand{max-height:0;overflow:hidden;transition:max-height 0.4s ease,opacity 0.3s ease;opacity:0}
    .expand-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px;padding-top:14px;border-top:1px solid rgba(0,255,136,0.08)}
    .expand-item{background:rgba(0,255,136,0.05);border-radius:6px;padding:10px 12px}
    .expand-label{font-family:'JetBrains Mono',monospace;font-size:10px;color:#00FF88;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px}
    .expand-value{font-size:12px;color:#E8F5EE}
    .pulse-dot{width:6px;height:6px;border-radius:50%;background:#00FF88;flex-shrink:0;position:relative;display:inline-block}
    .pulse-dot::after{content:'';position:absolute;inset:-3px;border-radius:50%;background:#00FF88;opacity:0.3;animation:vt-ring-pulse 2s ease-out infinite}
    @keyframes vt-ring-pulse{0%{transform:scale(1);opacity:0.3}100%{transform:scale(2.5);opacity:0}}
    .panel-col{position:sticky;top:40px}
    .panel{background:rgba(12,16,14,0.95);border:1px solid rgba(0,255,136,0.12);border-radius:16px;overflow:hidden}
    .terminal{background:#020905;border-bottom:1px solid rgba(0,255,136,0.12);padding:20px 24px}
    .terminal-bar{display:flex;align-items:center;gap:8px;margin-bottom:16px}
    .t-dot{width:10px;height:10px;border-radius:50%}
    .t-dot-r{background:#FF5F56}.t-dot-y{background:#FFBD2E}.t-dot-g{background:#27C93F}
    .terminal-title{font-family:'JetBrains Mono',monospace;font-size:11px;color:#6B8A76;margin-left:8px;letter-spacing:0.05em}
    .terminal-body{font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.8;min-height:160px}
    .t-line{display:flex;align-items:baseline;gap:8px;margin-bottom:2px;opacity:0;animation:vt-fade-in 0.3s ease forwards}
    @keyframes vt-fade-in{to{opacity:1}}
    .t-prompt{color:#00FF88;flex-shrink:0}
    .t-key{color:#6BFFA8;min-width:180px}
    .t-val{color:#E8F5EE;font-weight:500}
    .t-status{color:#00FF88}
    .t-muted{color:#6B8A76}
    .t-amber{color:#F5A623}
    .metrics-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:rgba(0,255,136,0.12);border-bottom:1px solid rgba(0,255,136,0.12)}
    .metric{background:rgba(5,10,8,0.95);padding:16px 20px}
    .metric-label{font-family:'JetBrains Mono',monospace;font-size:9px;color:#6B8A76;text-transform:uppercase;letter-spacing:0.15em;margin-bottom:6px}
    .metric-val{font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:700;color:#E8F5EE;line-height:1}
    .metric-unit{font-size:11px;color:#00FF88;margin-left:2px}
    .metric-delta{font-size:10px;color:#00FF88;margin-top:4px}
    .pipeline{padding:20px 24px}
    .pipeline-title{font-family:'JetBrains Mono',monospace;font-size:10px;color:#6B8A76;text-transform:uppercase;letter-spacing:0.15em;margin-bottom:16px}
    .pipeline-nodes{display:flex;align-items:center;overflow-x:auto;padding-bottom:4px}
    .pipe-node{flex-shrink:0}
    .pipe-node-inner{background:rgba(0,255,136,0.06);border:1px solid rgba(0,255,136,0.12);border-radius:8px;padding:8px 12px;text-align:center;min-width:90px;transition:all 0.3s ease}
    .pipe-node.active .pipe-node-inner{border-color:#00FF88;background:rgba(0,255,136,0.1)}
    .pipe-node-num{font-family:'JetBrains Mono',monospace;font-size:9px;color:#00FF88;margin-bottom:4px}
    .pipe-node-label{font-size:10px;color:#E8F5EE;font-weight:500;line-height:1.3}
    .pipe-connector{width:20px;flex-shrink:0;height:2px;align-self:center;margin-top:-12px}
    .pipe-connector-line{height:2px;background:rgba(0,255,136,0.12);border-radius:1px;position:relative;overflow:hidden}
    .pipe-connector-flow{position:absolute;top:0;left:-100%;width:100%;height:100%;background:linear-gradient(to right,transparent,#00FF88,transparent);animation:vt-flow 2s linear infinite}
    @keyframes vt-flow{to{left:100%}}
    .graph-section{border-top:1px solid rgba(0,255,136,0.12);padding:20px 24px}
    .graph-canvas{width:100%;height:180px;position:relative;overflow:hidden}
    .graph-canvas canvas{display:block;width:100%}
    .status-bar{background:#020905;border-top:1px solid rgba(0,255,136,0.12);padding:10px 24px;display:flex;align-items:center;gap:16px}
    .status-dot{width:6px;height:6px;border-radius:50%;background:#00FF88;animation:vt-ring-pulse 1.5s ease-out infinite}
    .status-text{font-family:'JetBrains Mono',monospace;font-size:11px;color:#00FF88}
    .status-right{margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:10px;color:#6B8A76}
  `

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <section className="vt-section">
        <div className="vt-bg-grid" />
        <div className="vt-bg-scan" />
        <div className="vt-orb vt-orb-1" />
        <div className="vt-orb vt-orb-2" />
        <div className="particles" id="particles" />
        <div className="vt-container">
          <div className="vt-header">
            <div className="vt-eyebrow">VetIOS Intelligence Infrastructure</div>
            <h2 className="vt-headline">Training Veterinary Intelligence at Scale</h2>
            <p className="vt-subheadline">VetIOS continuously simulates clinical reasoning, patient outcomes, diagnostic pathways, and real-world veterinary workflows to improve intelligence over time.</p>
          </div>
          <div className="vt-grid">
            <div className="cards-col">
              <div className="sim-card">
                <div className="card-header">
                  <div className="card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/></svg></div>
                  <div>
                    <div className="card-title">Clinical Simulations</div>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginTop:3}}><div className="pulse-dot"/><span style={{fontFamily:'JetBrains Mono,monospace',fontSize:10,color:'#00FF88'}}>RUNNING</span></div>
                  </div>
                </div>
                <p className="card-desc">VetIOS runs thousands of synthetic veterinary cases to stress-test diagnostic reasoning across species, symptom combinations, and disease states.</p>
                <div className="card-expand">
                  <div className="expand-row">
                    <div className="expand-item"><div className="expand-label">Why it matters</div><div className="expand-value">Prevents reasoning collapse on edge-case presentations</div></div>
                    <div className="expand-item"><div className="expand-label">Intelligence gain</div><div className="expand-value">Differential accuracy improves +2.1% per 10K simulations</div></div>
                    <div className="expand-item"><div className="expand-label">Confidence impact</div><div className="expand-value">High — directly trains diagnostic confidence scoring</div></div>
                    <div className="expand-item"><div className="expand-label">Volume / day</div><div className="expand-value">18,420 cases</div></div>
                  </div>
                </div>
              </div>
              <div className="sim-card">
                <div className="card-header">
                  <div className="card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg></div>
                  <div>
                    <div className="card-title">Outcome Learning</div>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginTop:3}}><div className="pulse-dot"/><span style={{fontFamily:'JetBrains Mono,monospace',fontSize:10,color:'#00FF88'}}>ACTIVE</span></div>
                  </div>
                </div>
                <p className="card-desc">VetIOS retrains confidence pathways using verified outcomes and clinician corrections, closing the feedback loop between prediction and reality.</p>
                <div className="card-expand">
                  <div className="expand-row">
                    <div className="expand-item"><div className="expand-label">Why it matters</div><div className="expand-value">Prevents confidence drift from unverified predictions</div></div>
                    <div className="expand-item"><div className="expand-label">Intelligence gain</div><div className="expand-value">Corrected pathways propagate across related diagnoses</div></div>
                    <div className="expand-item"><div className="expand-label">Confidence impact</div><div className="expand-value">Critical — source of ground truth for the model</div></div>
                    <div className="expand-item"><div className="expand-label">Correction rate</div><div className="expand-value">3.2% of pathways updated daily</div></div>
                  </div>
                </div>
              </div>
              <div className="sim-card">
                <div className="card-header">
                  <div className="card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg></div>
                  <div>
                    <div className="card-title">Agent Interaction Modeling</div>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginTop:3}}><div className="pulse-dot"/><span style={{fontFamily:'JetBrains Mono,monospace',fontSize:10,color:'#00FF88'}}>MULTI-AGENT</span></div>
                  </div>
                </div>
                <p className="card-desc">Multiple intelligence agents simulate reasoning, disagreement, escalation, and consensus to surface edge cases and strengthen diagnostic robustness.</p>
                <div className="card-expand">
                  <div className="expand-row">
                    <div className="expand-item"><div className="expand-label">Why it matters</div><div className="expand-value">Exposes blind spots single-agent reasoning misses</div></div>
                    <div className="expand-item"><div className="expand-label">Intelligence gain</div><div className="expand-value">Disagreement events become high-priority training signals</div></div>
                    <div className="expand-item"><div className="expand-label">Confidence impact</div><div className="expand-value">Consensus rate directly tied to output confidence</div></div>
                    <div className="expand-item"><div className="expand-label">Active agents</div><div className="expand-value">7 specialized diagnostic agents</div></div>
                  </div>
                </div>
              </div>
              <div className="sim-card">
                <div className="card-header">
                  <div className="card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v4M12 11l-5.5 6M12 11l5.5 6"/></svg></div>
                  <div>
                    <div className="card-title">Veterinary Graph Training</div>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginTop:3}}><div className="pulse-dot"/><span style={{fontFamily:'JetBrains Mono,monospace',fontSize:10,color:'#00FF88'}}>TRAVERSING</span></div>
                  </div>
                </div>
                <p className="card-desc">Knowledge graph traversal continuously improves disease relationships and symptom pathways, expanding the diagnostic map across species and conditions.</p>
                <div className="card-expand">
                  <div className="expand-row">
                    <div className="expand-item"><div className="expand-label">Why it matters</div><div className="expand-value">Graph density directly correlates with recall accuracy</div></div>
                    <div className="expand-item"><div className="expand-label">Intelligence gain</div><div className="expand-value">New node relationships discovered through traversal</div></div>
                    <div className="expand-item"><div className="expand-label">Confidence impact</div><div className="expand-value">Strong — underpins multi-hop diagnostic reasoning</div></div>
                    <div className="expand-item"><div className="expand-label">Graph expansion</div><div className="expand-value">+1.8% knowledge coverage this cycle</div></div>
                  </div>
                </div>
              </div>
            </div>
            <div className="panel-col">
              <div className="panel">
                <div className="terminal">
                  <div className="terminal-bar">
                    <div className="t-dot t-dot-r"/><div className="t-dot t-dot-y"/><div className="t-dot t-dot-g"/>
                    <span className="terminal-title">vetios-runtime — training-loop v4.2.1</span>
                  </div>
                  <div className="terminal-body" id="terminal-body"/>
                </div>
                <div className="metrics-grid">
                  <div className="metric"><div className="metric-label">Cases / Day</div><div className="metric-val"><span id="m1">18,420</span></div><div className="metric-delta">↑ 4.2% vs yesterday</div></div>
                  <div className="metric"><div className="metric-label">Graph Nodes</div><div className="metric-val"><span id="m2">2.8</span><span className="metric-unit">M</span></div><div className="metric-delta">↑ +1.8% this cycle</div></div>
                  <div className="metric"><div className="metric-label">Model Confidence</div><div className="metric-val"><span id="m3">94.2</span><span className="metric-unit">%</span></div><div className="metric-delta">Stable ±0.1%</div></div>
                  <div className="metric"><div className="metric-label">Inference Drift</div><div className="metric-val" style={{fontSize:14,paddingTop:4,color:'#00FF88'}}>STABLE</div><div className="metric-delta">Within threshold</div></div>
                  <div className="metric"><div className="metric-label">Consensus Rate</div><div className="metric-val"><span id="m4">91.7</span><span className="metric-unit">%</span></div><div className="metric-delta">↑ +0.3% today</div></div>
                  <div className="metric"><div className="metric-label">Telemetry</div><div className="metric-val"><span id="m5">847</span><span className="metric-unit">k</span></div><div className="metric-delta">signals / hour</div></div>
                </div>
                <div className="pipeline">
                  <div className="pipeline-title">Active Training Pipeline</div>
                  <div className="pipeline-nodes" id="pipeline"/>
                </div>
                <div className="graph-section">
                  <div className="pipeline-title">Knowledge Graph Traversal — Live</div>
                  <div className="graph-canvas"><canvas id="graphCanvas"/></div>
                </div>
                <div className="status-bar">
                  <div className="status-dot"/>
                  <span className="status-text">VetIOS Runtime Training...</span>
                  <span className="status-right" id="clock">--:--:-- UTC</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
