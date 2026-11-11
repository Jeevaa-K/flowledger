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
const CAT_EMOJIS = {Food:'🍔',Transport:'🚗',Shopping:'🛍️',Entertainment:'🎬',Health:'💊',Bills:'💡',Salary:'💼',Freelance:'💻',Investment:'📈',Other:'📦'};

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

    if (!data || !data.timeline || !data.timeline.length) return;

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
                    lines.push(`  ${ev.type === 'income' ? '💼' : '⚡'} ${ev.description}: ${sign}${curr}${Number(ev.amount).toLocaleString(loc)}`);
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