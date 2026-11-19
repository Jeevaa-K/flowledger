const CAT_COLORS = {
  Food:          '#F43F5E',
  Transport:     '#06B6D4',
  Shopping:      '#8B5CF6',
  Entertainment: '#EC4899',
  Health:        '#10B981',
  Bills:         '#F59E0B',
  Salary:        '#6366F1',
  Freelance:     '#14B8A6',
  Investment:    '#8B5CF6',
  Other:         '#94A3B8'
};
const CAT_EMOJIS = {
  Food: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="vertical-align:middle;margin-right:4px"><path d="M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8zM6 1v3M10 1v3M14 1v3"/></svg>',
  Transport: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="vertical-align:middle;margin-right:4px"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
  Shopping: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="vertical-align:middle;margin-right:4px"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
  Entertainment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="vertical-align:middle;margin-right:4px"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>',
  Health: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="vertical-align:middle;margin-right:4px"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  Bills: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="vertical-align:middle;margin-right:4px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
  Salary: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="vertical-align:middle;margin-right:4px"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>',
  Freelance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="vertical-align:middle;margin-right:4px"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
  Investment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="vertical-align:middle;margin-right:4px"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
  Other: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="vertical-align:middle;margin-right:4px"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>'
};

const TOOLTIP = {
  backgroundColor:'#0F172A',
  borderColor:'#1E293B',
  borderWidth:1,
  titleColor:'#F8FAFC',
  bodyColor:'#94A3B8',
  bodyFont:{family:'JetBrains Mono',size:12},
  padding:14,
  cornerRadius:10,
  callbacks:{label:ctx=>' '+currentCurrency()+Number(ctx.raw).toLocaleString(CURRENCY_LOCALE[currentCurrency()]||'en-IN')}
};

const SCALES = {
  x:{
    ticks:{color:'#64748B',font:{family:'Inter',size:11}},
    grid:{display:false},
    border:{display:false}
  },
  y:{
    ticks:{color:'#64748B',font:{family:'JetBrains Mono',size:10},callback:v=>currentCurrency()+(v>=1000?(v/1000).toFixed(0)+'k':v)},
    grid:{color:'rgba(226,232,240,0.6)'},
    border:{display:false}
  }
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
          datasets: [{ data:data.map(d=>d.total), backgroundColor:data.map(d=>CAT_COLORS[d.category]||'#94A3B8'), borderWidth:3, borderColor:'#FFFFFF', hoverOffset:10 }]
        },
        options: {
          responsive:true, maintainAspectRatio:false,
          cutout: type==='doughnut' ? '68%' : 0,
          plugins: {
            legend: { position:'bottom', labels:{color:'#64748B',font:{family:'Inter',size:11},boxWidth:10,padding:14,usePointStyle:true,pointStyle:'circle'} },
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
        { label:'Income',  data:income,  backgroundColor:type==='bar'?'rgba(16,185,129,0.85)':'transparent',  borderColor:'#10B981', borderWidth:2, borderRadius:type==='bar'?8:0, fill:type==='line', tension:0.4, pointBackgroundColor:'#10B981', pointRadius:type==='line'?4:0 },
        { label:'Expenses',data:expense, backgroundColor:type==='bar'?'rgba(244,63,94,0.85)':'transparent', borderColor:'#F43F5E', borderWidth:2, borderRadius:type==='bar'?8:0, fill:type==='line', tension:0.4, pointBackgroundColor:'#F43F5E', pointRadius:type==='line'?4:0 }
      ]},
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{labels:{color:'#64748B',font:{family:'Inter',size:11},usePointStyle:true,pointStyle:'circle'}}, tooltip:TOOLTIP }, scales:SCALES }
    });
  },

  renderLine(trend) {
    this.destroy('line');
    const ctx = document.getElementById('lineChart')?.getContext('2d');
    if (!ctx) return;
    const rev = [...(trend||[])].reverse();
    if (!rev.length) {
      charts.line = new Chart(ctx, {
        type: 'line',
        data: {
          labels: ['No trend data yet'],
          datasets: [{
            label: 'No data',
            data: [0],
            borderColor: '#CBD5E1',
            borderDash: [5, 5],
            pointRadius: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { enabled: false }
          },
          scales: SCALES
        }
      });
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
          borderColor:'#10B981',
          backgroundColor: (ctx2) => { const g=ctx2.chart.ctx.createLinearGradient(0,0,0,ctx2.chart.height); g.addColorStop(0,'rgba(16,185,129,0.28)'); g.addColorStop(1,'rgba(16,185,129,0)'); return g; },
          fill:true, tension:0.45, borderWidth:2.5,
          pointBackgroundColor:'#fff', pointBorderColor:'#10B981', pointBorderWidth:2, pointRadius:5, pointHoverRadius:8
        },
        {
          label:'Expenses', data:expense,
          borderColor:'#F43F5E',
          backgroundColor: (ctx2) => { const g=ctx2.chart.ctx.createLinearGradient(0,0,0,ctx2.chart.height); g.addColorStop(0,'rgba(244,63,94,0.20)'); g.addColorStop(1,'rgba(244,63,94,0)'); return g; },
          fill:true, tension:0.45, borderWidth:2.5,
          pointBackgroundColor:'#fff', pointBorderColor:'#F43F5E', pointBorderWidth:2, pointRadius:5, pointHoverRadius:8
        },
        {
          label:'Savings', data:savings,
          borderColor:'#8B5CF6',
          backgroundColor: (ctx2) => { const g=ctx2.chart.ctx.createLinearGradient(0,0,0,ctx2.chart.height); g.addColorStop(0,'rgba(139,92,246,0.18)'); g.addColorStop(1,'rgba(139,92,246,0)'); return g; },
          fill:true, tension:0.45, borderWidth:2, borderDash:[5,4],
          pointBackgroundColor:'#fff', pointBorderColor:'#8B5CF6', pointBorderWidth:2, pointRadius:4, pointHoverRadius:7
        }
      ]},
      options: {
        responsive:true, maintainAspectRatio:false,
        interaction:{ mode:'index', intersect:false },
        plugins: {
          legend: { position:'top', labels:{color:'#475569',font:{family:'Inter',size:12},usePointStyle:true,pointStyle:'circle',padding:20} },
          tooltip: {
            backgroundColor:'#0F172A', borderColor:'#1E293B', borderWidth:1,
            titleColor:'#F8FAFC', bodyColor:'#94A3B8',
            bodyFont:{family:'JetBrains Mono',size:12}, padding:14, cornerRadius:10,
            callbacks:{ label:ctx=>' '+ctx.dataset.label+': '+currentCurrency()+Number(ctx.raw).toLocaleString(CURRENCY_LOCALE[currentCurrency()]||'en-IN') }
          }
        },
        scales: {
          x:{ ticks:{color:'#64748B',font:{family:'Inter',size:12}}, grid:{display:false}, border:{display:false} },
          y:{ ticks:{color:'#64748B',font:{family:'JetBrains Mono',size:11},callback:v=>currentCurrency()+(v>=1000?(v/1000).toFixed(0)+'k':v)}, grid:{color:'rgba(226,232,240,0.6)'}, border:{display:false}, beginAtZero:true }
        }
      }
    });
  },

  renderCashflowForecast(data) {
    this.destroy('cashflow');
    window._lastCashflowData = data;
    const canvas = document.getElementById('cashflowForecastChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const container = canvas.closest('.cashflow-chart-container');
    if (!data || !data.timeline || !data.timeline.length) {
      if (container) container.style.display = 'none';
      return;
    }
    if (container) container.style.display = 'block';

    const labels = data.timeline.map(t => {
      const parts = t.date.split('-');
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      return d.toLocaleDateString('default', { month: 'short', day: 'numeric' });
    });

    const balances = data.timeline.map(t => t.balance);

    let strokeColor = '#6366F1';
    let gradTop = 'rgba(99, 102, 241, 0.28)';
    let gradBottom = 'rgba(99, 102, 241, 0.0)';

    if (data.status === 'danger') {
      strokeColor = '#EF4444';
      gradTop = 'rgba(239, 68, 68, 0.32)';
      gradBottom = 'rgba(239, 68, 68, 0.0)';
    } else if (data.status === 'warning') {
      strokeColor = '#F59E0B';
      gradTop = 'rgba(245, 158, 11, 0.28)';
      gradBottom = 'rgba(245, 158, 11, 0.0)';
    } else if (data.net_change >= 0) {
      strokeColor = '#10B981';
      gradTop = 'rgba(16, 185, 129, 0.28)';
      gradBottom = 'rgba(16, 185, 129, 0.0)';
    }

    const pointRadii = data.timeline.map(t => (t.events && t.events.length) ? 5 : 0);
    const pointHoverRadii = data.timeline.map(t => (t.events && t.events.length) ? 8 : 4);
    const pointBgColors = data.timeline.map(t => {
      if (t.events && t.events.length) {
        const hasIncome = t.events.some(e => e.type === 'income');
        return hasIncome ? '#10B981' : '#F43F5E';
      }
      return strokeColor;
    });

    charts.cashflow = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Projected Balance',
          data: balances,
          borderColor: strokeColor,
          borderWidth: 2.5,
          tension: 0.35,
          fill: true,
          backgroundColor: (ctx2) => {
            const chart = ctx2.chart;
            const { ctx: c, height: h } = chart;
            const gradient = c.createLinearGradient(0, 0, 0, h || 220);
            gradient.addColorStop(0, gradTop);
            gradient.addColorStop(1, gradBottom);
            return gradient;
          },
          pointRadius: pointRadii,
          pointHoverRadius: pointHoverRadii,
          pointBackgroundColor: pointBgColors,
          pointBorderColor: '#FFFFFF',
          pointBorderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0F172A',
            borderColor: '#1E293B',
            borderWidth: 1,
            titleColor: '#F8FAFC',
            bodyColor: '#94A3B8',
            bodyFont: { family: 'JetBrains Mono', size: 12 },
            padding: 14,
            cornerRadius: 10,
            callbacks: {
              label: (ctx) => {
                const idx = ctx.dataIndex;
                const pt = data.timeline[idx];
                const bal = Number(ctx.raw);
                const curr = currentCurrency();
                const loc = CURRENCY_LOCALE[curr] || 'en-IN';
                let lines = [' Balance: ' + curr + bal.toLocaleString(loc)];
                if (pt && pt.events && pt.events.length) {
                  for (const ev of pt.events) {
                    const sign = ev.type === 'income' ? '+' : '-';
                    lines.push(`  • ${ev.description}: ${sign}${curr}${Number(ev.amount).toLocaleString(loc)}`);
                  }
                }
                return lines;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: {
              color: '#64748B',
              font: { family: 'Inter', size: 11 },
              maxTicksLimit: 10
            },
            grid: { display: false },
            border: { display: false }
          },
          y: {
            ticks: {
              color: '#64748B',
              font: { family: 'JetBrains Mono', size: 10 },
              callback: (v) => currentCurrency() + (Math.abs(v) >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)
            },
            grid: { color: 'rgba(226, 232, 240, 0.6)' },
            border: { display: false }
          }
        }
      }
    });
  }
};