// ── Overall analysis & tips (called after session stop) ──
async function runOverallAnalysis(){
  const btn=document.getElementById('btnAnalyse');
  const body=document.getElementById('analysisBody');
  if(!body)return;
  const inner=document.getElementById('analysisInner');
  if(inner)inner.classList.add('revealed');
  updateEmotionBars();
  const chip=document.getElementById('engScoreChip');
  const chipNum=document.getElementById('engScoreChipNum');
  if(chip&&chipNum){chip.style.display='flex';chipNum.textContent=Math.round(engagementScore);}
  btn.disabled=true;
  body.innerHTML='<div class="analysis-typing"><span></span><span></span><span></span></div> Generating analysis…';
  const total=Object.values(emotionCounts).reduce((a,b)=>a+b,0)||1;
  const mf=Object.entries(emotionCounts).sort((a,b)=>b[1]-a[1])[0];
  const emotionSummary=Object.entries(emotionCounts).sort((a,b)=>b[1]-a[1])
    .map(([k,v])=>`${EMOTION_LABELS[k]||k}: ${Math.round(v/total*100)}%`).join(', ');
  try{
    // Parse duration label
    const _rawDur=document.getElementById('sumDuration')?.textContent||'';
    let _durLabel='unknown';
    if(_rawDur){
      const parts=_rawDur.trim().split(':').map(Number);
      if(parts.length===2){const[m,s]=parts;_durLabel=m>0?`${m} min ${s} sec`:`${s} sec`;}
      else if(parts.length===3){const[h,m,s]=parts;_durLabel=h>0?`${h} hr ${m} min ${s} sec`:`${m} min ${s} sec`;}
      else{_durLabel=_rawDur;}
    }
    const total2=Object.values(emotionCounts).reduce((a,b)=>a+b,0)||1;
    const p=k=>Math.round(((emotionCounts[k]||0)/total2)*100);
    const posPct=p('happy')+p('surprised');
    const negPct=p('angry')+p('sad')+p('fearful')+p('disgusted');
    const neuPct=p('neutral');
    const allEvents=timelineEvents.map(e=>`${e.timeLabel}: ${e.label}`).join('; ');
    const negEventsList=timelineEvents.filter(e=>['angry','sad','fearful','disgusted'].includes(e.dotClass))
      .map(e=>`${e.timeLabel} (${EMOTION_LABELS[e.dotClass]||e.dotClass})`).join(', ');
    const timelineContext=[
      allEvents?`Full timeline — ${allEvents}`:'No events recorded.',
      negEventsList?`Negative moments at: ${negEventsList}`:'No negative moments.',
      `Emotion breakdown — Positive: ${posPct}%, Negative: ${negPct}%, Neutral: ${neuPct}%`,
      `Engagement score: ${Math.round(engagementScore)}/100`,
      `Session duration: ${_durLabel}`
    ].join(' | ');
    const res=await Auth.apiFetch('/generate-insights',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        duration:_durLabel,
        emotion_summary:emotionSummary||'No data',
        most_frequent_emotion:mf?(EMOTION_LABELS[mf[0]]||mf[0]):'N/A',
        engagement_score:Math.round(engagementScore),
        reactions_sent:reactionCount,
        timeline_context:timelineContext,
        positive_pct:posPct,negative_pct:negPct,neutral_pct:neuPct,
        instructions:'Give specific, direct advice using the exact timestamps and emotions provided. Never say "see session data", "check the timeline", or "refer to details" — all data is already here, embed it directly in your response.'
      })
    });
    if(!res.ok){const err=await res.json().catch(()=>({}));throw new Error(err.detail||`Server error ${res.status}`);}
    const parsed=await res.json();
    if(parsed.insights&&Array.isArray(parsed.insights)){
      // Build timeline note
      const negEmoEvents=timelineEvents.filter(e=>['angry','sad','fearful','disgusted'].includes(e.dotClass));
      const lastEmoEvents=timelineEvents.filter(e=>['happy','neutral','sad','angry','surprised','fearful','disgusted'].includes(e.dotClass));
      let timeNote='';
      if(negEmoEvents.length>0){
        const firstNeg=negEmoEvents[0];
        const negBreakdown=[emotionCounts.angry?`Angry: ${p('angry')}%`:'',emotionCounts.sad?`Sad: ${p('sad')}%`:'',emotionCounts.fearful?`Fear: ${p('fearful')}%`:'',emotionCounts.disgusted?`Disgust: ${p('disgusted')}%`:''].filter(Boolean).join(' · ');
        timeNote=`<div class="insight-item" style="border-color:rgba(220,38,38,0.3);background:rgba(220,38,38,0.04)"><div class="insight-item-title" style="color:#dc2626">⚠ Negative emotions detected at ${firstNeg.timeLabel}</div><div class="insight-item-desc">Learner showed <strong>${EMOTION_LABELS[firstNeg.dotClass]||firstNeg.dotClass}</strong> at ${firstNeg.timeLabel}${negBreakdown?` (${negBreakdown})`:''}. Review what content was presented at this timestamp — consider slowing pace, rephrasing, or adding a check-in question.</div></div>`;
      }else if(lastEmoEvents.length>=2){
        const last=lastEmoEvents[lastEmoEvents.length-1];
        const prev=lastEmoEvents[lastEmoEvents.length-2];
        if(last.dotClass!==prev.dotClass)timeNote=`<div class="insight-item" style="border-color:rgba(232,68,10,0.25);background:rgba(232,68,10,0.04)"><div class="insight-item-title">Emotion shift at ${last.timeLabel}</div><div class="insight-item-desc">Changed from <strong>${EMOTION_LABELS[prev.dotClass]||prev.dotClass}</strong> → <strong>${EMOTION_LABELS[last.dotClass]||last.dotClass}</strong>. Review the content shown at this moment to identify what triggered the change.</div></div>`;
      }
      // AI insights panel (first 2)
      const VAGUE=['see session','check the timeline','refer to','session data','for details','look at the','review the data','consult the'];
      const aiInsights=parsed.insights.slice(0,2);
      const tipInsights=parsed.insights.slice(2).filter(t=>!VAGUE.some(ph=>(t.title+' '+t.desc).toLowerCase().includes(ph)));
      body.innerHTML='<div class="insights-list">'+timeNote+aiInsights.map(ins=>{
        let desc=ins.desc.replace(/see session data for details\.?/gi,'').replace(/check the (session )?timeline for (more )?details\.?/gi,'').replace(/refer to (the )?session data\.?/gi,'').replace(/\s{2,}/g,' ').trim();
        return`<div class="insight-item"><div class="insight-item-title">${ins.title}</div><div class="insight-item-desc">${desc}</div></div>`;
      }).join('')+'</div>';
      // Tips panel
      const tipsBody=document.getElementById('tipsBody');
      if(tipsBody){
        const negEvents=timelineEvents.filter(e=>['angry','sad','fearful','disgusted'].includes(e.dotClass));
        const firstNegAt=negEvents.length>0?negEvents[0].timeLabel:null;
        const firstNegEmo=negEvents.length>0?(EMOTION_LABELS[negEvents[0].dotClass]||negEvents[0].dotClass):null;
        const allNegTimes=negEvents.map(e=>`${e.timeLabel} (${EMOTION_LABELS[e.dotClass]||e.dotClass})`).join(', ');
        const tips=[];
        if(negPct>=30){
          const worstNeg=Object.entries({angry:p('angry'),sad:p('sad'),fearful:p('fearful'),disgusted:p('disgusted')}).sort((a,b)=>b[1]-a[1])[0];
          const atTime=firstNegAt?` starting at <strong>${firstNegAt}</strong>`:'';
          tips.push({color:'#dc2626',title:`High negative (${negPct}%)`,desc:`Significant frustration detected${atTime}${allNegTimes?` — spikes at: ${allNegTimes}`:''}. Break down complex ideas, slow delivery, and directly ask "Is this clear?" at those moments.`});
          if(worstNeg&&worstNeg[1]>0){
            const worstLabel=EMOTION_LABELS[worstNeg[0]]||worstNeg[0];
            const worstTime=timelineEvents.filter(e=>e.dotClass===worstNeg[0]).map((e,i)=>i===0?` first seen at <strong>${e.timeLabel}</strong>`:'')[0]||'';
            tips.push({color:'#dc2626',title:`Dominant: ${worstLabel} (${worstNeg[1]}%)`,desc:`<strong>${worstLabel}</strong>${worstTime}. Revisit the content shown at that moment — use simpler language, relatable analogies, or pause for a quick Q&A to resolve confusion.`});
          }
        }else if(negPct>=10){
          const atTime=firstNegAt?` — first appeared at <strong>${firstNegAt}</strong> (${firstNegEmo})${negEvents.length>1?`, again at ${negEvents.slice(1).map(e=>`<strong>${e.timeLabel}</strong>`).join(', ')}`:''}`:'— no specific timestamp recorded';
          tips.push({color:'#f97316',title:`Some discomfort (${negPct}% negative)`,desc:`Negativity${atTime}. Revisit what you were explaining at that point — offer a brief recap, slow down, or ask the learner if they need clarification before moving on.`});
        }else{
          tips.push({color:'#16a34a',title:'Low negative emotions',desc:'Content was well-received with little frustration. Keep the same clarity and pacing in future sessions.'});
        }
        if(posPct>=60)tips.push({color:'#16a34a',title:`Strong positive session (${posPct}%)`,desc:'Above 60% positive threshold — great engagement. Maintain this content pace and structure for future sessions.'});
        else if(neuPct>=50)tips.push({color:'#6b7280',title:`High neutral (${neuPct}%)`,desc:'Learner may be passive. Add interactive questions, change delivery style, or introduce a short activity to spark engagement.'});
        const eng2=Math.round(engagementScore);
        if(eng2<50)tips.push({color:'#e8440a',title:`Boost engagement (score: ${eng2}/100)`,desc:'Try 10–15 min focused bursts with 5 min breaks. Add interactive polls or Q&A moments to re-activate attention.'});
        else if(eng2<75)tips.push({color:'#ca8a04',title:`Moderate engagement (score: ${eng2}/100)`,desc:'Use active recall every 5 min — pause and ask the learner to summarize what was just covered.'});
        const tipHtml=t=>`<div class="tip-item"><div class="tip-dot" style="background:${t.color}"></div><div><strong style="font-size:10.5px;color:var(--text)">${t.title}:</strong> ${t.desc}</div></div>`;
        const llmHtml=t=>`<div class="tip-item"><div class="tip-dot"></div><div><strong style="font-size:10.5px;color:var(--text)">${t.title}:</strong> ${t.desc}</div></div>`;
        tipsBody.innerHTML=tips.map(tipHtml).join('')+(tipInsights.length>0?tipInsights.map(llmHtml).join(''):'');
      }
    }else{
      body.innerHTML='<span class="analysis-empty">Could not parse analysis. Please try again.</span>';
    }
  }catch(e){
    body.innerHTML=`<span class="analysis-empty">Analysis unavailable: ${e.message||'Please try again.'}</span>`;
  }
  btn.disabled=false;
}