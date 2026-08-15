const LEDGER_SUMMARY_MIN_MONTH={year:2026,month:6};
let ledgerSummaryMonth=(()=>{const now=new Date();return{year:now.getFullYear(),month:now.getMonth()+1}})();

function ledgerSummaryPrefix(year,month){return`${year}-${String(month).padStart(2,"0")}-`}
function ledgerSummaryMonthLabel(year,month){return`${year}年${month}月`}
function ledgerSummaryTradeAmountUSD(transaction){const shares=num(transaction.shares),price=num(transaction.price),fee=num(transaction.fee),rate=num(transaction.fxRate||1),gross=shares*price;return round((gross+(transaction.type==="buy"?fee:-fee))*rate)}
function ledgerSummaryCashFlowAmountUSD(flow){return round(num(flow.amountUSD))}
function ledgerSummaryForMonth(year=ledgerSummaryMonth.year,month=ledgerSummaryMonth.month){
  const prefix=ledgerSummaryPrefix(year,month),validTransactions=(state.transactions||[]).filter(t=>!t?.voided&&String(t?.date||"").startsWith(prefix)&&["buy","sell"].includes(t?.type));
  const validCashFlows=(state.cashFlows||[]).filter(flow=>!flow?.voided&&String(flow?.date||"").startsWith(prefix)&&["deposit","withdraw"].includes(flow?.type));
  const buyUSD=validTransactions.filter(t=>t.type==="buy").reduce((sum,t)=>sum+ledgerSummaryTradeAmountUSD(t),0);
  const sellUSD=validTransactions.filter(t=>t.type==="sell").reduce((sum,t)=>sum+ledgerSummaryTradeAmountUSD(t),0);
  const depositUSD=validCashFlows.filter(flow=>flow.type==="deposit").reduce((sum,flow)=>sum+ledgerSummaryCashFlowAmountUSD(flow),0);
  const withdrawUSD=validCashFlows.filter(flow=>flow.type==="withdraw").reduce((sum,flow)=>sum+ledgerSummaryCashFlowAmountUSD(flow),0);
  const realizedPnlUSD=validTransactions.filter(t=>t.type==="sell").reduce((sum,t)=>sum+num(t.realizedPnlUSD),0);
  const recentTrades=validTransactions.slice().sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))||String(b.id||"").localeCompare(String(a.id||""))).slice(0,5).map(t=>({id:t.id||`${t.date}-${t.symbol}`,date:t.date,type:t.type,symbol:t.symbol||"—",name:t.name||t.symbol||"—",shares:num(t.shares),amountUSD:ledgerSummaryTradeAmountUSD(t),realizedPnlUSD:t.type==="sell"?num(t.realizedPnlUSD):null,note:t.note||""}));
  return{year,month,buyUSD:round(buyUSD),sellUSD:round(sellUSD),depositUSD:round(depositUSD),withdrawUSD:round(withdrawUSD),realizedPnlUSD:round(realizedPnlUSD),netCashUSD:round(sellUSD+depositUSD-buyUSD-withdrawUSD),recentTrades};
}
function ledgerSummarySignedMoney(value){const amount=round(value);return`${amount>0?"+":""}${money(amount)}`}
function renderLedgerSummary(){
  const month=$("ledgerSummaryMonth"),grid=$("ledgerSummaryGrid"),net=$("ledgerSummaryNet"),recent=$("ledgerSummaryRecent"),previous=$("ledgerSummaryPrev"),next=$("ledgerSummaryNext");
  if(!month||!grid||!net||!recent)return;
  const{year,month:monthNumber}=ledgerSummaryMonth,summary=ledgerSummaryForMonth(year,monthNumber),now=new Date(),currentMonth=new Date(now.getFullYear(),now.getMonth(),1),shownMonth=new Date(year,monthNumber-1,1);
  month.textContent=ledgerSummaryMonthLabel(year,monthNumber);
  if(previous)previous.disabled=year*12+monthNumber-1<=LEDGER_SUMMARY_MIN_MONTH.year*12+LEDGER_SUMMARY_MIN_MONTH.month-1;
  if(next)next.disabled=shownMonth>=currentMonth;
  const metrics=[
    ["买入金额",summary.buyUSD,"out"],
    ["卖出金额",summary.sellUSD,"in"],
    ["追加本金",summary.depositUSD,"in"],
    ["已实现盈亏",summary.realizedPnlUSD,summary.realizedPnlUSD>=0?"in":"out"],
  ];
  grid.innerHTML=metrics.map(([label,value,direction])=>`<article class="ledger-summary-metric ${direction}"><span>${label}</span><strong>${money(value)}</strong><small>${label==="已实现盈亏"?"来自本月卖出记录":"按美元统一统计"}</small></article>`).join("");
  const netClass=summary.netCashUSD>0?"in":summary.netCashUSD<0?"out":"flat";
  net.innerHTML=`<div class="ledger-summary-net-copy"><span>本月净现金变化</span><strong class="${netClass}">${ledgerSummarySignedMoney(summary.netCashUSD)}</strong><small>卖出 + 追加本金 − 买入 − 提取本金</small></div><div class="ledger-summary-net-breakdown"><span>提取本金 <b>${money(summary.withdrawUSD)}</b></span><span>共 ${summary.recentTrades.length} 笔交易</span></div>`;
  recent.innerHTML=summary.recentTrades.length?summary.recentTrades.map(trade=>`<div class="ledger-summary-row"><div><b class="${trade.type==="buy"?"out":"in"}">${trade.type==="buy"?"买入":"卖出"}</b><strong>${escapeHtml(trade.symbol)}</strong><small>${escapeHtml(trade.name)} · ${escapeHtml(trade.date||"")}</small></div><span>${trade.type==="buy"?"-":"+"}${money(trade.amountUSD)}</span></div>`).join(""):"<p class=\"ledger-summary-empty\">本月还没有买入或卖出记录。</p>";
  syncLedgerHeight();
}
function changeLedgerSummaryMonth(direction){
  const next=new Date(ledgerSummaryMonth.year,ledgerSummaryMonth.month-1+direction,1),now=new Date(),currentMonth=new Date(now.getFullYear(),now.getMonth(),1);
  if(next>currentMonth||next.getFullYear()*12+next.getMonth()<LEDGER_SUMMARY_MIN_MONTH.year*12+LEDGER_SUMMARY_MIN_MONTH.month-1)return;
  ledgerSummaryMonth={year:next.getFullYear(),month:next.getMonth()+1};renderLedgerSummary();
}
