// 梦想金库 V7
// 只需要把下面这一行换成你的 Twelve Data Key
const TWELVE_DATA_API_KEY = "da5601ce51f74a18909eeb565fbbdc6c";

// 根据你最新截图录入，后面新增持仓只改这里
const portfolio = [
  { symbol:"MU",   name:"美光科技",       source:"twelve", currency:"USD", qty:0,  cost:890,    sector:"AI基建" },
  { symbol:"NVDA", name:"英伟达",         source:"twelve", currency:"USD", qty:10, cost:215.2,   sector:"AI基建" },
  { symbol:"MRVL", name:"迈威尔",         source:"twelve", currency:"USD", qty:9,  cost:325.04,  sector:"AI基建" },
  { symbol:"AAOI", name:"应用光电",       source:"twelve", currency:"USD", qty:4,  cost:205.085, sector:"光通讯" },
  { symbol:"LITE", name:"Lumentum",       source:"twelve", currency:"USD", qty:1,  cost:855,     sector:"光通讯" },
  { symbol:"XFAB", name:"芯片代工",       source:"manual", currency:"EUR", qty:44, cost:11.685,  manualPrice:10.71, fxToUsd:1.16, sector:"光通讯" },
  { symbol:"CBRS", name:"Cerebras Syste", source:"twelve", currency:"USD", qty:5,  cost:208.5,   sector:"AI基建" },
  { symbol:"RKLB", name:"火箭实验室",     source:"twelve", currency:"USD", qty:30, cost:114.08,  sector:"太空" },
  { symbol:"VRT",  name:"维谛技术",       source:"twelve", currency:"USD", qty:5,  cost:310.07,  sector:"AI基建" }
];

const CACHE_KEY = "dream_vault_v7_prices";
const CACHE_MS = 10 * 60 * 1000;

function money(n){return "$" + Number(n || 0).toLocaleString(undefined,{maximumFractionDigits:2});}
function pct(n){return (Number(n||0)).toFixed(2) + "%";}
function price(n,c="USD"){return Number(n||0).toLocaleString(undefined,{maximumFractionDigits:3}) + " " + c;}
function el(id){return document.getElementById(id);}

async function fetchJson(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error("网络错误 " + res.status);
  const data = await res.json();
  if(data.status === "error" || data.code) throw new Error(data.message || ("API错误 " + data.code));
  return data;
}

async function getPrices(force=false){
  const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
  if(!force && cached && Date.now() - cached.time < CACHE_MS) return cached.prices;

  const prices = {};
  for(const item of portfolio.filter(x=>x.source==="manual")){
    prices[item.symbol] = item.manualPrice;
  }

  const symbols = portfolio.filter(x=>x.source==="twelve").map(x=>x.symbol);
  if(symbols.length){
    const url = `https://api.twelvedata.com/price?symbol=${symbols.join(",")}&apikey=${encodeURIComponent(TWELVE_DATA_API_KEY)}`;
    const data = await fetchJson(url);
    if(symbols.length === 1){
      prices[symbols[0]] = Number(data.price);
    }else{
      for(const s of symbols){
        if(data[s] && data[s].price) prices[s] = Number(data[s].price);
      }
    }
  }

  localStorage.setItem(CACHE_KEY, JSON.stringify({time:Date.now(), prices}));
  return prices;
}

function render(prices={}){
  let totalValue=0,totalCost=0;
  const body = el("portfolioBody");
  body.innerHTML = "";

  for(const item of portfolio){
    const p = Number(prices[item.symbol] ?? item.manualPrice ?? 0);
    const fx = item.fxToUsd || 1;
    const valueUsd = item.qty * p * fx;
    const costUsd = item.qty * item.cost * fx;
    const pnl = valueUsd - costUsd;
    const ret = costUsd ? pnl / costUsd * 100 : 0;
    totalValue += valueUsd;
    totalCost += costUsd;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${item.symbol}</strong></td>
      <td>${item.name}</td>
      <td>${item.qty}</td>
      <td>${price(item.cost,item.currency)}</td>
      <td>${p ? price(p,item.currency) : '<span class="muted">--</span>'}</td>
      <td>${money(valueUsd)}</td>
      <td>${money(costUsd)}</td>
      <td class="${pnl>=0?'gain':'loss'}">${money(pnl)}</td>
      <td class="${ret>=0?'gain':'loss'}">${pct(ret)}</td>
      <td>${item.sector}</td>`;
    body.appendChild(tr);
  }

  const totalPnl = totalValue - totalCost;
  const totalRet = totalCost ? totalPnl / totalCost * 100 : 0;
  el("totalValue").textContent = money(totalValue);
  el("totalPnl").textContent = money(totalPnl);
  el("totalPnl").className = totalPnl >= 0 ? "gain" : "loss";
  el("totalReturn").textContent = pct(totalRet);
  el("totalReturn").className = totalRet >= 0 ? "gain" : "loss";
}

async function refreshPrices(force=false){
  const btn = el("refreshBtn");
  btn.disabled = true;
  el("statusText").textContent = "刷新中...";
  try{
    const prices = await getPrices(force);
    render(prices);
    el("statusText").textContent = "已更新";
    el("lastUpdated").textContent = "更新时间：" + new Date().toLocaleString();
  }catch(e){
    console.warn("刷新失败，使用缓存", e);
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if(cached){
      render(cached.prices);
      el("statusText").textContent = "使用缓存";
      el("lastUpdated").textContent = "API受限，显示上次价格";
    }else{
      render({});
      el("statusText").textContent = "刷新失败";
      el("lastUpdated").textContent = e.message;
    }
  }finally{
    btn.disabled = false;
  }
}

if(new URLSearchParams(location.search).get("admin") === "1"){
  el("adminPanel").classList.remove("hidden");
}

render({});
refreshPrices(false); // 打开网站自动刷新一次
el("refreshBtn").addEventListener("click", ()=>refreshPrices(true));
// V7 已取消 setInterval 自动循环刷新，避免 429
