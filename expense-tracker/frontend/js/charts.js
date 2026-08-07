const CAT_COLORS = {Food:'#BF5730',Transport:'#4E7C8C',Shopping:'#9B6B9E',Entertainment:'#B85C7A',Health:'#5C8A6E',Bills:'#B8862F',Salary:'#3E6154',Freelance:'#7C7250',Investment:'#3E6154',Other:'#A79C8C'};
const CAT_EMOJIS = {Food:'🍔',Transport:'🚗',Shopping:'🛍️',Entertainment:'🎬',Health:'💊',Bills:'💡',Salary:'💼',Freelance:'💻',Investment:'📈',Other:'📦'};

const TOOLTIP = {
  backgroundColor:'#2B2620',borderColor:'#453E34',borderWidth:1,
  titleColor:'#FAF6EF',bodyColor:'#C7BEB0',
  bodyFont:{family:'JetBrains Mono',size:12},padding:12,
  // currentCurrency()/CURRENCY_LOCALE are defined in ui.js, which loads
  // AFTER this file — safe because callbacks only run when a chart is
  // actually rendered, well after every script has finished loading.
  callbacks:{label:ctx=>' '+currentCurrency()+Number(ctx.raw).toLocaleString(CURRENCY_LOCALE[currentCurrency()]||'en-IN')}
};

const SCALES = {
  x:{ticks:{color:'#A79C8C',font:{family:'JetBrains Mono',size:10}},grid:{display:false},border:{display:false}},
  y:{ticks:{color:'#A79C8C',font:{family:'JetBrains Mono',size:10},callback:v=>currentCurrency()+(v>=1000?(v/1000).toFixed(0)+'k':v)},grid:{color:'#EFE8D8'},border:{display:false}}
};

let charts = {};

const Charts = {
  getCatColor(cat) { return CAT_COLORS[cat] || '#A79C8C'; },

  destroy(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } },

  renderDoughnut(data, type='doughnut') {
    this.destroy('doughnut');
    window._lastCatData = data;
    const ctx = document.getElementById('doughnutChart')?.getContext('2d');
    if (!ctx) return;
    if (!data || !data.length) {
      charts.doughnut = new Chart(ctx, {
        type: 'doughnut',
        data: { labels:['No expenses yet'], datasets:[{data:[1],backgroundColor:['#F5F0E6'],borderWidth:0}] },
        options: { responsive:true, maintainAspectRatio:false, cutout:'72%', plugins:{legend:{display:false},tooltip:{enabled:false}} }
      });
      return;
    }
    charts.doughnut = new Chart(ctx, {
      type,
      data: {
        labels: data.map(d=>d.category),
        datasets: [{ data:data.map(d=>d.total), backgroundColor:data.map(d=>CAT_COLORS[d.category]||'#A79C8C'), borderWidth:3, borderColor:'#FFFFFF', hoverOffset:8 }]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        cutout: type==='doughnut' ? '65%' : 0,
        plugins: {
          legend: { position:'bottom', labels:{color:'#7C7266',font:{family:'Inter',size:11},boxWidth:10,padding:12,usePointStyle:true,pointStyle:'circle'} },
          tooltip: TOOLTIP
        }
      }
    });
  },

  renderBar(trend, type='bar') {
    this.destroy('bar');
    window._lastTrendData = trend;
    const ctx = document.getElementById('barChart')?.getContext('2d');
    if (!ctx) return;
    const rev    = [...(trend||[])].reverse();
    const labels = rev.map(t => { const[y,m]=t.month.split('-'); return new Date(y,m-1).toLocaleString('default',{month:'short',year:'2-digit'}); });
    const income  = rev.map(t => Number(t.income)||0);
    const expense = rev.map(t => Number(t.expense)||0);
    charts.bar = new Chart(ctx, {
      type,
      data: { labels, datasets: [
        { label:'Income',  data:income,  backgroundColor:type==='bar'?'rgba(62,97,84,0.85)':'transparent',  borderColor:'#3E6154', borderWidth:2, borderRadius:type==='bar'?6:0, fill:type==='line', tension:0.4, pointBackgroundColor:'#3E6154', pointRadius:type==='line'?4:0 },
        { label:'Expenses',data:expense, backgroundColor:type==='bar'?'rgba(166,64,47,0.85)':'transparent', borderColor:'#A6402F', borderWidth:2, borderRadius:type==='bar'?6:0, fill:type==='line', tension:0.4, pointBackgroundColor:'#A6402F', pointRadius:type==='line'?4:0 }
      ]},
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{labels:{color:'#7C7266',font:{family:'Inter',size:11},usePointStyle:true,pointStyle:'circle'}}, tooltip:TOOLTIP }, scales:SCALES }
    });
  },

  renderLine(trend) {
    this.destroy('line');
    const ctx = document.getElementById('lineChart')?.getContext('2d');
    if (!ctx) return;
    const rev = [...(trend||[])].reverse();
    if (!rev.length) {
      ctx.canvas.parentElement.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#A79C8C;font-size:13px">No data yet — add transactions to see trends</div>';
      return;
    }
    const labels  = rev.map(t => { const[y,m]=t.month.split('-'); return new Date(y,m-1).toLocaleString('default',{month:'short',year:'numeric'}); });
    const income  = rev.map(t => Number(t.income)||0);
    const expense = rev.map(t => Number(t.expense)||0);
    const savings = rev.map((t,i) => Math.max(0, income[i]-expense[i]));

    charts.line = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [
        {
          label:'Income', data:income,
          borderColor:'#3E6154',
          backgroundColor: (ctx2) => { const g=ctx2.chart.ctx.createLinearGradient(0,0,0,ctx2.chart.height); g.addColorStop(0,'rgba(62,97,84,0.30)'); g.addColorStop(1,'rgba(62,97,84,0)'); return g; },
          fill:true, tension:0.45, borderWidth:2.5,
          pointBackgroundColor:'#fff', pointBorderColor:'#3E6154', pointBorderWidth:2, pointRadius:5, pointHoverRadius:8
        },
        {
          label:'Expenses', data:expense,
          borderColor:'#A6402F',
          backgroundColor: (ctx2) => { const g=ctx2.chart.ctx.createLinearGradient(0,0,0,ctx2.chart.height); g.addColorStop(0,'rgba(166,64,47,0.22)'); g.addColorStop(1,'rgba(166,64,47,0)'); return g; },
          fill:true, tension:0.45, borderWidth:2.5,
          pointBackgroundColor:'#fff', pointBorderColor:'#A6402F', pointBorderWidth:2, pointRadius:5, pointHoverRadius:8
        },
        {
          label:'Savings', data:savings,
          borderColor:'#BF5730',
          backgroundColor: (ctx2) => { const g=ctx2.chart.ctx.createLinearGradient(0,0,0,ctx2.chart.height); g.addColorStop(0,'rgba(191,87,48,0.18)'); g.addColorStop(1,'rgba(191,87,48,0)'); return g; },
          fill:true, tension:0.45, borderWidth:2, borderDash:[5,4],
          pointBackgroundColor:'#fff', pointBorderColor:'#BF5730', pointBorderWidth:2, pointRadius:4, pointHoverRadius:7
        }
      ]},
      options: {
        responsive:true, maintainAspectRatio:false,
        interaction:{ mode:'index', intersect:false },
        plugins: {
          legend: { position:'top', labels:{color:'#2B2620',font:{family:'Inter',size:12},usePointStyle:true,pointStyle:'circle',padding:20} },
          tooltip: {
            backgroundColor:'#2B2620', borderColor:'#453E34', borderWidth:1,
            titleColor:'#FAF6EF', bodyColor:'#C7BEB0',
            bodyFont:{family:'JetBrains Mono',size:12}, padding:12,
            callbacks:{ label:ctx=>' '+ctx.dataset.label+': '+currentCurrency()+Number(ctx.raw).toLocaleString(CURRENCY_LOCALE[currentCurrency()]||'en-IN') }
          }
        },
        scales: {
          x:{ ticks:{color:'#7C7266',font:{family:'Inter',size:12}}, grid:{display:false}, border:{display:false} },
          y:{ ticks:{color:'#7C7266',font:{family:'JetBrains Mono',size:11},callback:v=>currentCurrency()+(v>=1000?(v/1000).toFixed(0)+'k':v)}, grid:{color:'#EFE8D8'}, border:{display:false}, beginAtZero:true }
        }
      }
    });
  }
};