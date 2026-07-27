const CAT_COLORS = {Food:'#f97316',Transport:'#38bdf8',Shopping:'#a78bfa',Entertainment:'#fb7185',Health:'#34d399',Bills:'#fbbf24',Salary:'#6366f1',Freelance:'#c084fc',Investment:'#10b981',Other:'#94a3b8'};
const CAT_EMOJIS = {Food:'🍔',Transport:'🚗',Shopping:'🛍️',Entertainment:'🎬',Health:'💊',Bills:'💡',Salary:'💼',Freelance:'💻',Investment:'📈',Other:'📦'};

const TOOLTIP = {
  backgroundColor:'#1e293b',borderColor:'#334155',borderWidth:1,
  titleColor:'#f1f5f9',bodyColor:'#94a3b8',
  bodyFont:{family:'JetBrains Mono',size:12},padding:12,
  callbacks:{label:ctx=>' ₹'+Number(ctx.raw).toLocaleString('en-IN')}
};

const SCALES = {
  x:{ticks:{color:'#9ca3af',font:{family:'JetBrains Mono',size:10}},grid:{display:false},border:{display:false}},
  y:{ticks:{color:'#9ca3af',font:{family:'JetBrains Mono',size:10},callback:v=>'₹'+(v>=1000?(v/1000).toFixed(0)+'k':v)},grid:{color:'#f3f4f6'},border:{display:false}}
};

let charts = {};

const Charts = {
  getCatColor(cat) { return CAT_COLORS[cat] || '#94a3b8'; },

  destroy(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } },

  renderDoughnut(data, type='doughnut') {
    this.destroy('doughnut');
    window._lastCatData = data;
    const ctx = document.getElementById('doughnutChart')?.getContext('2d');
    if (!ctx) return;
    if (!data || !data.length) {
      charts.doughnut = new Chart(ctx, {
        type: 'doughnut',
        data: { labels:['No expenses yet'], datasets:[{data:[1],backgroundColor:['#f3f4f6'],borderWidth:0}] },
        options: { responsive:true, maintainAspectRatio:false, cutout:'72%', plugins:{legend:{display:false},tooltip:{enabled:false}} }
      });
      return;
    }
    charts.doughnut = new Chart(ctx, {
      type,
      data: {
        labels: data.map(d=>d.category),
        datasets: [{ data:data.map(d=>d.total), backgroundColor:data.map(d=>CAT_COLORS[d.category]||'#94a3b8'), borderWidth:3, borderColor:'#ffffff', hoverOffset:8 }]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        cutout: type==='doughnut' ? '65%' : 0,
        plugins: {
          legend: { position:'bottom', labels:{color:'#6b7280',font:{family:'Inter',size:11},boxWidth:10,padding:12,usePointStyle:true,pointStyle:'circle'} },
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
        { label:'Income',  data:income,  backgroundColor:type==='bar'?'rgba(16,185,129,0.8)':'transparent',  borderColor:'#10b981', borderWidth:2, borderRadius:type==='bar'?6:0, fill:type==='line', tension:0.4, pointBackgroundColor:'#10b981', pointRadius:type==='line'?4:0 },
        { label:'Expenses',data:expense, backgroundColor:type==='bar'?'rgba(239,68,68,0.8)':'transparent', borderColor:'#ef4444', borderWidth:2, borderRadius:type==='bar'?6:0, fill:type==='line', tension:0.4, pointBackgroundColor:'#ef4444', pointRadius:type==='line'?4:0 }
      ]},
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{labels:{color:'#6b7280',font:{family:'Inter',size:11},usePointStyle:true,pointStyle:'circle'}}, tooltip:TOOLTIP }, scales:SCALES }
    });
  },

  renderLine(trend) {
    this.destroy('line');
    const ctx = document.getElementById('lineChart')?.getContext('2d');
    if (!ctx) return;
    const rev = [...(trend||[])].reverse();
    if (!rev.length) {
      ctx.canvas.parentElement.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#9ca3af;font-size:13px">No data yet — add transactions to see trends</div>';
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
          borderColor:'#10b981',
          backgroundColor: (ctx2) => { const g=ctx2.chart.ctx.createLinearGradient(0,0,0,ctx2.chart.height); g.addColorStop(0,'rgba(16,185,129,0.35)'); g.addColorStop(1,'rgba(16,185,129,0)'); return g; },
          fill:true, tension:0.45, borderWidth:2.5,
          pointBackgroundColor:'#fff', pointBorderColor:'#10b981', pointBorderWidth:2, pointRadius:5, pointHoverRadius:8
        },
        {
          label:'Expenses', data:expense,
          borderColor:'#ef4444',
          backgroundColor: (ctx2) => { const g=ctx2.chart.ctx.createLinearGradient(0,0,0,ctx2.chart.height); g.addColorStop(0,'rgba(239,68,68,0.25)'); g.addColorStop(1,'rgba(239,68,68,0)'); return g; },
          fill:true, tension:0.45, borderWidth:2.5,
          pointBackgroundColor:'#fff', pointBorderColor:'#ef4444', pointBorderWidth:2, pointRadius:5, pointHoverRadius:8
        },
        {
          label:'Savings', data:savings,
          borderColor:'#6366f1',
          backgroundColor: (ctx2) => { const g=ctx2.chart.ctx.createLinearGradient(0,0,0,ctx2.chart.height); g.addColorStop(0,'rgba(99,102,241,0.2)'); g.addColorStop(1,'rgba(99,102,241,0)'); return g; },
          fill:true, tension:0.45, borderWidth:2, borderDash:[5,4],
          pointBackgroundColor:'#fff', pointBorderColor:'#6366f1', pointBorderWidth:2, pointRadius:4, pointHoverRadius:7
        }
      ]},
      options: {
        responsive:true, maintainAspectRatio:false,
        interaction:{ mode:'index', intersect:false },
        plugins: {
          legend: { position:'top', labels:{color:'#374151',font:{family:'Inter',size:12},usePointStyle:true,pointStyle:'circle',padding:20} },
          tooltip: {
            backgroundColor:'#1e293b', borderColor:'#334155', borderWidth:1,
            titleColor:'#f1f5f9', bodyColor:'#94a3b8',
            bodyFont:{family:'JetBrains Mono',size:12}, padding:12,
            callbacks:{ label:ctx=>' '+ctx.dataset.label+': ₹'+Number(ctx.raw).toLocaleString('en-IN') }
          }
        },
        scales: {
          x:{ ticks:{color:'#6b7280',font:{family:'Inter',size:12}}, grid:{display:false}, border:{display:false} },
          y:{ ticks:{color:'#6b7280',font:{family:'JetBrains Mono',size:11},callback:v=>'₹'+(v>=1000?(v/1000).toFixed(0)+'k':v)}, grid:{color:'#f3f4f6'}, border:{display:false}, beginAtZero:true }
        }
      }
    });
  }
};
