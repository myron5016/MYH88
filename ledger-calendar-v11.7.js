let ledgerCalendarMonth=(()=>{const now=new Date();return{year:now.getFullYear(),month:now.getMonth()+1}})();
let activeLedgerCalendarDate="";

function ledgerCalendarEvents(year,month){
  const prefix=`${year}-${String(month).padStart(2,"0")}-`;
  const trades=state.transactions.filter(t=>!t.voided&&String(t.date||"").startsWith(prefix)&&["buy","sell"].includes(t.type)).map(t=>({date:t.date,kind:t.type,title:`${transactionLabel(t)} ${t.symbol||""}`.trim(),amountUSD:round((num(t.shares)*num(t.price)+(t.type==="buy"?num(t.fee):-num(t.fee)))*num(t.fxRate||1)),note:t.note||"",direction:t.type==="buy"?"out":"in"}));
  const cash=state.cashFlows.filter(flow=>!flow.voided&&String(flow.date||"").startsWith(prefix)).map(flow=>({date:flow.date,kind:flow.type,title:flow.type==="withdraw"?"提取本金":"追加本金",amountUSD:round(num(flow.amountUSD)),note:flow.note||"",direction:flow.type==="withdraw"?"out":"in"}));
  return[...trades,...cash].sort((a,b)=>a.date.localeCompare(b.date)||a.kind.localeCompare(b.kind));
}
function ledgerCalendarDate(year,month,day){return`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`}
function renderLedgerCalendar(){
  const monthLabel=$("ledgerCalendarMonth"),grid=$("ledgerCalendarGrid"),details=$("ledgerCalendarDetails"),previous=$("ledgerCalendarPrev"),next=$("ledgerCalendarNext");
  if(!monthLabel||!grid||!details)return;
  const {year,month}=ledgerCalendarMonth,events=ledgerCalendarEvents(year,month),byDate=events.reduce((map,event)=>{(map[event.date]||=[]).push(event);return map},{});
  const firstDay=new Date(year,month-1,1),lastDay=new Date(year,month,0).getDate(),start=(firstDay.getDay()+6)%7,totalCells=Math.ceil((start+lastDay)/7)*7;
  const now=new Date(),currentMonth=new Date(now.getFullYear(),now.getMonth(),1),shownMonth=new Date(year,month-1,1);
  monthLabel.textContent=`${year}年${month}月操作日历`;
  if(previous)previous.disabled=false;
  if(next)next.disabled=shownMonth>=currentMonth;
  grid.innerHTML=Array.from({length:totalCells},(_,index)=>{
    const day=index-start+1;
    if(day<1||day>lastDay)return'<div class="ledger-calendar-day is-empty" aria-hidden="true"></div>';
    const date=ledgerCalendarDate(year,month,day),dayEvents=byDate[date]||[],selected=activeLedgerCalendarDate===date;
    const cards=dayEvents.slice(0,2).map(event=>`<span class="ledger-calendar-event ${event.direction}">${escapeHtml(event.title)}</span>`).join("");
    const remainder=dayEvents.length>2?`<span class="ledger-calendar-more">另 ${dayEvents.length-2} 笔</span>`:"";
    return`<button type="button" class="ledger-calendar-day${dayEvents.length?" has-events":""}${selected?" selected":""}" data-ledger-date="${date}" onclick="selectLedgerCalendarDate('${date}')"><time datetime="${date}">${day}</time>${cards}${remainder}</button>`;
  }).join("");
  if(!activeLedgerCalendarDate){details.innerHTML=events.length?'<p>选择一个有记录的日期，查看当天完整操作。</p>':'<p>本月尚无账本记录。</p>';return}
  const selected=byDate[activeLedgerCalendarDate]||[];
  details.innerHTML=selected.length?`<strong>${escapeHtml(activeLedgerCalendarDate)} 的操作</strong><div class="ledger-calendar-detail-list">${selected.map(event=>`<div class="${event.direction}"><b>${escapeHtml(event.title)}</b><span>${event.direction==="in"?"+":"-"}${money(event.amountUSD)}${event.note?` · ${escapeHtml(event.note)}`:""}</span></div>`).join("")}</div>`:'<p>当天没有账本记录。</p>';
}
function selectLedgerCalendarDate(date){activeLedgerCalendarDate=activeLedgerCalendarDate===date?"":date;renderLedgerCalendar();syncLedgerHeight()}
function changeLedgerCalendarMonth(direction){
  const next=new Date(ledgerCalendarMonth.year,ledgerCalendarMonth.month-1+direction,1),now=new Date(),currentMonth=new Date(now.getFullYear(),now.getMonth(),1);
  if(next>currentMonth)return;
  ledgerCalendarMonth={year:next.getFullYear(),month:next.getMonth()+1};activeLedgerCalendarDate="";renderLedgerCalendar();syncLedgerHeight();
}
