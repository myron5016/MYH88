const quoteRequestHistory=[];
const quoteIssues={};
function renderMarketAdminPanel(){
  const box=$("marketAdminGrid");if(!box)return;
  const live=[...new Set(state.positions.filter(p=>p.source==="twelve"&&p.symbol).map(p=>p.symbol))];
  const manual=state.positions.filter(p=>p.source==="manual").map(p=>p.symbol).filter(Boolean);
  const sourceCounts=quoteSourceSummary();
  const health=workerHealth||{};
  const twelveConfigured=health.providers?.twelve??health.secretConfigured;
  const finnhubConfigured=health.providers?.finnhub??health.finnhubConfigured;
  const clock=marketClockState||marketClock();
  const checked=health.checkedAt?new Date(health.checkedAt).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"未检测";
  const last=state.settings.lastPriceRefreshText||"暂无";
  box.innerHTML=[
    ["行情来源",marketRouteLabel(),lastQuoteCache?`缓存头：${lastQuoteCache}`:"等待下一次刷新"],
    ["来源分布",`TWE ${sourceCounts.twe} / FIN ${sourceCounts.fin} / 收盘 ${sourceCounts.close}` ,`手填 ${sourceCounts.manual} / 静态 ${sourceCounts.static} / 待刷新 ${sourceCounts.pending}`],
    ["美股时钟",marketClockDisplay(clock),clock.source==="finnhub"?"Finnhub 实时状态":"本地休市表兜底"],
    ["自动刷新",autoRefreshPlan(),"页面读取缓存；缓存缺失的收盘请求可能调用行情源"],
    ["实时标的",`${live.length} 只`,live.join(", ")||"无"],
    ["手动资产",manual.length?manual.join(", "):"无","手动资产不消耗行情 API"],
    ["EUR/USD",round(state.fxRates.EUR||defaultState.fxRates.EUR,6),"手动汇率，不请求 TWE 汇率接口"],
    ["Worker",health.ok===undefined?"未检测":yesNo(health.ok),`V${health.version||"?"} / TWE ${twelveConfigured?"已配":"未配"} / FIN ${finnhubConfigured?"已配":"未配"} / KV ${health.sharedCache?"已启用":"未启用"} / ${checked}`],
    ["行情分配",health.routing?`TWE ${health.routing.twelve?.length||0} / FIN ${health.routing.finnhub?.length||0}`:"等待检测",health.routing?`TWE：${health.routing.twelve?.join(", ")||"无"}；FIN：${health.routing.finnhub?.join(", ")||"无"}`:"固定优先级和逐股缓存"],
    ["部署指纹",deploymentFingerprint().mismatch?"版本不一致":"版本一致",deploymentFingerprint().label],
    ["最近刷新",last,lastQuoteWarnings?`警告：${lastQuoteWarnings}`:"暂无行情警告"],
    ["额度口径","不等于服务商账单","请求记录仅统计本页面；实际 API 与 KV 用量以服务商后台为准"]
  ].map(([title,value,detail])=>`<div class="market-admin-item"><span>${escapeHtml(title)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></div>`).join("");
  renderQuoteDiagnosticDetails();
}
function renderQuoteDiagnosticDetails(){
  const box=$("quoteDiagnosticDetails");if(!box)return;
  const items=[...state.positions,...(state.dcaPlan?.funds||[])];
  const rows=items.map(item=>{
    const issue=quoteIssues[item.symbol],manual=item.source==="manual";
    const stamp=item.priceAsOf||item.priceUpdatedAt;
    const source=manual?"手填":item.priceSource==="static"?"静态缓存":({twelve:"TWE",finnhub:"FIN",tencent:"腾讯",static:"静态缓存","last-close":"收盘缓存"}[item.priceProvider||item.priceSource]||"本机记录");
    return `<tr><td>${escapeHtml(item.symbol)}</td><td>${escapeHtml(source)}</td><td>${escapeHtml(stamp||"时间未知")}</td><td>${escapeHtml(issue||(manual?"不请求行情":item.priceSource==="static"?"代理失败，使用历史缓存":item.priceSource==="last-close"?"收盘价":"以来源时间为准"))}</td></tr>`;
  }).join("");
  const requests=quoteRequestHistory.map(item=>`<tr><td>${escapeHtml(item.at)}</td><td>${escapeHtml(item.mode==="last-close"?"收盘价":"盘中缓存")}</td><td>${escapeHtml(item.status)}</td><td>${item.elapsed} ms</td><td>${escapeHtml(item.cache||"—")}</td><td>${escapeHtml(item.error||item.symbols.join(", "))}</td></tr>`).join("");
  box.innerHTML=`<h3>逐股行情诊断</h3><div class="quote-diagnostic-scroll"><table><thead><tr><th>代码</th><th>价格来源</th><th>来源时间</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table></div><h3>本次打开页面的最近请求</h3><div class="quote-diagnostic-scroll"><table><thead><tr><th>请求时间</th><th>类型</th><th>HTTP</th><th>耗时</th><th>缓存</th><th>标的或原因</th></tr></thead><tbody>${requests||'<tr><td colspan="6">暂无请求记录</td></tr>'}</tbody></table></div>`;
}
function recordQuoteRequest(record){
  quoteRequestHistory.unshift({...record,at:new Date().toLocaleTimeString("zh-CN")});
  quoteRequestHistory.length=Math.min(quoteRequestHistory.length,20);
}
async function quoteHttpError(response){
  const body=await response.json().catch(()=>({}));
  const pending=body.code==="PORTFOLIO_SYMBOLS_PENDING"||body.error==="Only current portfolio symbols may be requested";
  const reason=pending?`持仓名单尚未同步：${(body.symbols||[]).join(", ")}`:
    response.status===429?"刷新受限，稍后再试":response.status>=500?"行情服务暂时不可用":"请求参数未被接受";
  const error=new Error(`HTTP ${response.status}：${reason}`);error.status=response.status;return error;
}
