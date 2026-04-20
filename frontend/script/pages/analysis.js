// ── Overall analysis & tips (called after session stop) ──
async function runOverallAnalysis(){
  const btn=document.getElementById('btnAnalyse');
  const body=document.getElementById('analysisBody');
  if(!body)return;
  const inner=document.getElementById('analysisInner');
  if(inner)inner.classList.add('revealed');
  updateEmotionBars();
  const chip=document.getElementById('engScoreChip');
  if(chip){chip.style.display='none';} // engagement shown once in session summary only
  btn.disabled=true;
  body.innerHTML='<div class="analysis-typing"><span></span><span></span><span></span></div> Generating analysis…';
  const total=Object.values(emotionCounts).reduce((a,b)=>a+b,0)||1;
  const mf=Object.entries(emotionCounts).sort((a,b)=>b[1]-a[1])[0];
  const emotionSummary=Object.entries(emotionCounts).sort((a,b)=>b[1]-a[1])
    .map(([k,v])=>`${EMOTION_LABELS[k]||k}: ${Math.round(v/total*100)}%`).join(', ');
  try{
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
        spike_summary:_lastSpikeSummary||{total_spikes:0,drops:0,surges:0,spike_frames:[]},
        instructions:'Write in plain friendly English. No jargon. No timestamps. Speak like a supportive coach.'
      })
    });
    if(!res.ok){const err=await res.json().catch(()=>({}));throw new Error(err.detail||`Server error ${res.status}`);}
    const parsed=await res.json();
    if(parsed.insights&&Array.isArray(parsed.insights)){

      // ── Top alert card ──
      const negEmoEvents=timelineEvents.filter(e=>['angry','sad','fearful','disgusted'].includes(e.dotClass));
      const lastEmoEvents=timelineEvents.filter(e=>['happy','neutral','sad','angry','surprised','fearful','disgusted'].includes(e.dotClass));
      let timeNote='';
      if(negEmoEvents.length>0){
        const firstNeg=negEmoEvents[0];
        const negBreakdown=[
          emotionCounts.angry?`Angry: ${p('angry')}%`:'',
          emotionCounts.sad?`Sad: ${p('sad')}%`:'',
          emotionCounts.fearful?`Fear: ${p('fearful')}%`:'',
          emotionCounts.disgusted?`Disgust: ${p('disgusted')}%`:''
        ].filter(Boolean).join(' · ');
        timeNote='<div class="insight-item" style="border-color:rgba(220,38,38,0.3);background:rgba(220,38,38,0.04)">'
          +'<div class="insight-item-title" style="color:#dc2626">⚠ Some frustration showed up during this session</div>'
          +'<div class="insight-item-desc">The learner appeared <strong>'+(EMOTION_LABELS[firstNeg.dotClass]||firstNeg.dotClass)+'</strong> at some point'+(negBreakdown?' ('+negBreakdown+')':'')+'. It might help to slow down, simplify the explanation, or pause and ask <em>"Does this make sense so far?"</em></div>'
          +'</div>';
      }else if(lastEmoEvents.length>=2){
        const last=lastEmoEvents[lastEmoEvents.length-1];
        const prev=lastEmoEvents[lastEmoEvents.length-2];
        if(last.dotClass!==prev.dotClass){
          timeNote='<div class="insight-item" style="border-color:rgba(232,68,10,0.25);background:rgba(232,68,10,0.04)">'
            +'<div class="insight-item-title">The learner\'s mood shifted near the end</div>'
            +'<div class="insight-item-desc">They moved from feeling <strong>'+(EMOTION_LABELS[prev.dotClass]||prev.dotClass)+'</strong> to <strong>'+(EMOTION_LABELS[last.dotClass]||last.dotClass)+'</strong> towards the end. Think about what was being discussed at that point — it may be worth revisiting.</div>'
            +'</div>';
        }
      }

      // ── AI insight cards ──
      const VAGUE=['see session','check the timeline','refer to','session data','for details','look at the','review the data','consult the'];
      const aiInsights=parsed.insights.slice(0,2);
      const tipInsights=parsed.insights.slice(2).filter(t=>!VAGUE.some(ph=>(t.title+' '+t.desc).toLowerCase().includes(ph)));
      body.innerHTML='<div class="insights-list">'+timeNote+aiInsights.map(ins=>{
        let desc=ins.desc
          .replace(/see session data for details\.?/gi,'')
          .replace(/check the (session )?timeline for (more )?details\.?/gi,'')
          .replace(/refer to (the )?session data\.?/gi,'')
          .replace(/at \d+:\d+/gi,'during the session')
          .replace(/\s{2,}/g,' ').trim();
        return '<div class="insight-item"><div class="insight-item-title">'+ins.title+'</div><div class="insight-item-desc">'+desc+'</div></div>';
      }).join('')+'</div>';

      // ── Tips panel — exactly 3 structured cards ──
      const tipsBody=document.getElementById('tipsBody');
      if(tipsBody){
        const negEvents=timelineEvents.filter(e=>['angry','sad','fearful','disgusted'].includes(e.dotClass));
        const firstNegEmo=negEvents.length>0?(EMOTION_LABELS[negEvents[0].dotClass]||negEvents[0].dotClass):null;
        const negCount=negEvents.length;
        const eng2=Math.round(engagementScore);

        // ── TIP 1: Emotion state ──
        let t1={};
        if(negPct>=30){
          t1={color:'#dc2626',label:'Emotion',
            desc:'Frustration or confusion was present for <strong>'+negPct+'% of the session</strong> — the content may have been too dense or fast-paced. Try breaking it into smaller segments and check in every few minutes with "Does this make sense so far?"'};
        }else if(negPct>=10){
          t1={color:'#f97316',label:'Emotion',
            desc:'A little discomfort showed up — mainly <strong>'+(firstNegEmo||'negative emotion')+'</strong> at <strong>'+negPct+'%</strong>'+(negCount>1?', detected '+negCount+' times':'')+'. Worth revisiting that section with a simpler analogy or a quick "Let me rephrase that."'};
        }else if(neuPct>=70){
          t1={color:'#6b7280',label:'Emotion',
            desc:'The learner was <strong>'+neuPct+'% neutral</strong> — calm and unreadable throughout. A neutral face doesn\'t confirm understanding. Ask them to explain the concept back in their own words, or use a 1–10 confidence check to surface any hidden confusion.'};
        }else if(neuPct>=50){
          t1={color:'#6b7280',label:'Emotion',
            desc:'The session was <strong>'+neuPct+'% neutral</strong> — calm but passive, with limited emotional reaction. Mix in a question or a surprising fact mid-session to spark more active engagement.'};
        }else{
          t1={color:'#16a34a',label:'Emotion',
            desc:'Positive emotion was at <strong>'+posPct+'%</strong> — the learner showed clear interest and engagement throughout. End with one quick question to confirm the key takeaway actually landed.'};
        }

        // ── TIP 2: Focus & engagement ──
        let t2={};
        if(eng2<50){
          t2={color:'#e8440a',label:'Focus',
            desc:'Engagement was <strong>low</strong> — attention drifted frequently during the session. Keep sessions under 15 minutes and add a mid-session question or short story to pull focus back before it slips.'};
        }else if(eng2<75){
          t2={color:'#ca8a04',label:'Focus',
            desc:'Engagement was <strong>moderate</strong> — the learner was reasonably attentive but not fully locked in. Pause every few minutes and ask them to summarise what was just covered in their own words to keep the brain active.'};
        }else{
          t2={color:'#16a34a',label:'Focus',
            desc:'Engagement was <strong>strong</strong> throughout — the learner stayed well focused across the session. Keep the same session length and structure; it\'s clearly working.'};
        }

        // ── TIP 3: Next session action ──
        let t3Desc='Facial expressions give a snapshot, not the full picture. Comprehension is invisible on the surface — add one interactive element next session, like a question, poll, or worked example, to see if the content truly landed.';
        if(tipInsights.length>0){
          const best=tipInsights[0];
          const cleaned=best.desc.replace(/see session data for details\.?/gi,'').replace(/check the (session )?timeline for (more )?details\.?/gi,'').replace(/refer to (the )?session data\.?/gi,'').replace(/at \d+:\d+/gi,'during the session').trim();
          if(cleaned) t3Desc=cleaned;
        }
        const t3={color:'#6366f1',label:'Next Session',desc:t3Desc};

        const cardHtml=t=>{
          const bg=t.color==='#dc2626'?'rgba(220,38,38,0.04)':t.color==='#f97316'?'rgba(249,115,22,0.04)':t.color==='#e8440a'?'rgba(232,68,10,0.04)':t.color==='#ca8a04'?'rgba(202,138,4,0.04)':t.color==='#16a34a'?'rgba(22,163,74,0.04)':t.color==='#6366f1'?'rgba(99,102,241,0.04)':'rgba(107,114,128,0.04)';
          return '<div style="border:1px solid '+t.color+'33;border-left:3px solid '+t.color+';border-radius:8px;padding:10px 14px;margin-bottom:8px;background:'+bg+'">'
            +'<div style="font-size:10px;font-weight:700;letter-spacing:0.06em;color:'+t.color+';margin-bottom:4px;text-transform:uppercase">'+t.label+'</div>'
            +'<div style="font-size:10.5px;line-height:1.6;color:var(--text);opacity:0.85">'+t.desc+'</div>'
            +'</div>';
        };
        tipsBody.innerHTML=[t1,t2,t3].map(cardHtml).join('');
      }
    }else{
      body.innerHTML='<span class="analysis-empty">Could not generate analysis. Please try again.</span>';
    }
  }catch(e){
    body.innerHTML='<span class="analysis-empty">Analysis unavailable: '+(e.message||'Please try again.')+'</span>';
  }
  btn.disabled=false;
}