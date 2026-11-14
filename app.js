/* ABSEN FC BERKAH 2027 PWA
 * Backend: Google Apps Script JSONP endpoint.
 * Offline: cache app shell + IndexedDB queue; sync when online.
 */
const API_URL = "https://script.google.com/macros/s/AKfycbz7K3dfHDWhNEW6lPZTNsi50OYCUDMtMn3iy1B06c0zO2Ko6xa-VFMA2PKw3oTIcY2GLg/exec";
const DB_NAME = "fcberkah2027";
const DB_VERSION = 1;
let db;
let token = "";
let records = [];

const $ = id => document.getElementById(id);
const months = ["JANUARI","FEBRUARI","MARET","APRIL","MEI","JUNI","JULI","AGUSTUS","SEPTEMBER","OKTOBER","NOVEMBER","DESEMBER"];

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{const d=req.result; if(!d.objectStoreNames.contains("cache"))d.createObjectStore("cache"); if(!d.objectStoreNames.contains("queue"))d.createObjectStore("queue",{keyPath:"id",autoIncrement:true});};
    req.onsuccess=()=>{db=req.result;resolve(db)};req.onerror=()=>reject(req.error);
  });
}
function store(name,mode="readonly"){return db.transaction(name,mode).objectStore(name)}
function getValue(name,key){return new Promise((resolve,reject)=>{const r=store(name).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
function putValue(name,key,value){return new Promise((resolve,reject)=>{const tx=db.transaction(name,"readwrite");tx.objectStore(name).put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
function allQueue(){return new Promise((resolve,reject)=>{const r=store("queue").getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error)})}
function deleteQueue(id){return new Promise((resolve,reject)=>{const tx=db.transaction("queue","readwrite");tx.objectStore("queue").delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}

function api(action,params={}){
  return new Promise((resolve,reject)=>{
    if(!API_URL.startsWith("https://script.google.com/")){reject(new Error("URL Apps Script belum diatur di app.js."));return;}
    const callback="fc_cb_"+Date.now()+"_"+Math.random().toString(36).slice(2);
    const script=document.createElement("script");
    const timeout=setTimeout(()=>finish(new Error("Server tidak merespons. Periksa koneksi internet.")),15000);
    function finish(err,data){clearTimeout(timeout);delete window[callback];script.remove();err?reject(err):resolve(data)}
    window[callback]=(data)=>{if(data&&data.ok)finish(null,data.result);else finish(new Error(data&&data.error||"Permintaan gagal."))};
    const query=new URLSearchParams({action,callback,...params});
    script.src=API_URL+"?"+query.toString();
    script.onerror=()=>finish(new Error("Tidak dapat menghubungi server absensi."));
    document.body.appendChild(script);
  });
}
function setMessage(id,msg,type=""){const el=$(id);el.textContent=msg;el.className="message "+type}
function networkState(){
  const online=navigator.onLine;
  $("networkBadge").textContent=online?"Online":"Offline";
  $("networkBadge").style.background=online?"#ffffff18":"#9a661f";
}
async function updateQueueBadge(){
  const q=await allQueue();$("pendingBadge").textContent=q.length+" antrean";
  $("syncStatus").textContent=q.length?`${q.length} perubahan menunggu sinkronisasi`:"Data terakhir tersimpan / tersinkron";
}
async function login(){
  const u=$("username").value.trim(),p=$("password").value;
  if(!u||!p){setMessage("loginMessage","Isi username dan password.","error");return}
  $("loginBtn").disabled=true;$("loginBtn").textContent="Memeriksa…";
  try{
    const result=await api("login",{username:u,password:p});
    token=result.token;sessionStorage.setItem("fc_admin_token",token);
    $("loginView").classList.add("hidden");$("appView").classList.remove("hidden");
    $("password").value="";
    await loadDashboard();await loadDay();
  }catch(e){setMessage("loginMessage",e.message,"error")}
  finally{$("loginBtn").disabled=false;$("loginBtn").textContent="Masuk"}
}
async function logout(){
  token="";sessionStorage.removeItem("fc_admin_token");
  $("appView").classList.add("hidden");$("loginView").classList.remove("hidden");
}
function renderMembers(data){
  records=data.records||[];const list=$("memberList");list.replaceChildren();
  records.forEach((r,i)=>{
    const row=document.createElement("div");row.className="member-row";
    const name=document.createElement("div");name.className="member-name";name.textContent=r.name;
    const select=document.createElement("select");select.dataset.index=i;
    [["","Pilih status"],[".","Hadir (.)"],["a","Alpha (a)"],["i","Izin (i)"],["L","Libur (L)"]].forEach(([v,t])=>{const o=document.createElement("option");o.value=v;o.textContent=t;select.append(o)});
    select.value=r.status||"";row.append(name,select);list.append(row);
  });
  $("saveBtn").disabled=!records.length;
}
async function loadDay(){
  if(!token)return;
  const date=$("attendanceDate").value;
  if(!navigator.onLine){
    const cached=await getValue("cache","day:"+date);
    if(cached){renderMembers(cached);setMessage("saveMessage","Mode offline: data tanggal ini dari cache. Perubahan akan masuk antrean.","");}
    else{$("memberList").innerHTML='<div class="empty">Data tanggal ini belum pernah dimuat. Sambungkan internet untuk memuatnya.</div>'}
    return;
  }
  $("loadDateBtn").disabled=true;
  try{
    const data=await api("day",{token,date});
    await putValue("cache","day:"+date,data);renderMembers(data);
    setMessage("saveMessage",`Data dimuat: ${data.day} · ${date}`,"ok");
  }catch(e){setMessage("saveMessage",e.message,"error")}
  finally{$("loadDateBtn").disabled=false}
}
async function saveDay(){
  if(!token||!records.length)return;
  const selects=[...document.querySelectorAll("#memberList select")];
  const submitted=selects.map(s=>({name:records[Number(s.dataset.index)].name,status:s.value}));
  if(submitted.some(r=>!r.status)){setMessage("saveMessage","Pilih status untuk semua anggota.","error");return}
  const date=$("attendanceDate").value;
  $("saveBtn").disabled=true;$("saveBtn").textContent="Menyimpan…";
  try{
    if(navigator.onLine){
      await api("save",{token,date,records:JSON.stringify(submitted)});
      setMessage("saveMessage","Absensi berhasil disimpan ke Google Sheets.","ok");
      await loadDashboard();await loadDay();
    }else{
      await store("queue","readwrite").add({date,records:submitted,createdAt:Date.now()});
      const cached=await getValue("cache","day:"+date);
      if(cached){cached.records=submitted.map((r,i)=>({...cached.records[i],status:r.status}));await putValue("cache","day:"+date,cached)}
      setMessage("saveMessage","Tersimpan di HP. Akan dikirim saat internet tersedia.","ok");
      await updateQueueBadge();
    }
  }catch(e){setMessage("saveMessage",e.message,"error")}
  finally{$("saveBtn").disabled=false;$("saveBtn").textContent="Simpan Absensi"}
}
async function loadDashboard(){
  if(!token)return;
  if(!navigator.onLine){const c=await getValue("cache","dashboard");if(c){renderDashboard(c);return}return}
  try{const data=await api("dashboard",{token});await putValue("cache","dashboard",data);renderDashboard(data)}
  catch(e){setMessage("saveMessage",e.message,"error")}
}
function renderDashboard(data){
  $("statMembers").textContent=data.members.length;$("statPresent").textContent=data.totals.hadir;
  $("statAbsent").textContent=data.totals.alpha;$("statExcused").textContent=data.totals.izin;
  const mb=$("memberSummary");mb.replaceChildren();
  data.members.forEach(m=>{const tr=document.createElement("tr");[m.name,m.hadir,m.alpha,m.izin,m.libur,(m.percent*100).toFixed(1)+"%"].forEach(v=>{const td=document.createElement("td");td.textContent=v;tr.append(td)});mb.append(tr)});
  const mo=$("monthSummary");mo.replaceChildren();
  data.monthly.forEach(m=>{const tr=document.createElement("tr");[m.month,m.hadir,m.alpha,m.izin,m.libur].forEach(v=>{const td=document.createElement("td");td.textContent=v;tr.append(td)});mo.append(tr)});
}
async function syncQueue(){
  if(!token||!navigator.onLine)return;
  const q=await allQueue();if(!q.length){await updateQueueBadge();return}
  $("syncBtn").disabled=true;$("syncBtn").textContent="Menyinkronkan…";
  try{
    for(const item of q){await api("save",{token,date:item.date,records:JSON.stringify(item.records)});await deleteQueue(item.id)}
    await loadDashboard();await loadDay();setMessage("saveMessage","Semua perubahan offline berhasil disinkronkan.","ok");
  }catch(e){setMessage("saveMessage","Sinkronisasi tertunda: "+e.message,"error")}
  finally{$("syncBtn").disabled=false;$("syncBtn").textContent="Sinkronkan sekarang";await updateQueueBadge()}
}
async function init(){
  await openDB();networkState();window.addEventListener("online",()=>{networkState();syncQueue()});window.addEventListener("offline",networkState);
  $("loginBtn").addEventListener("click",login);$("logoutBtn").addEventListener("click",logout);
  $("loadDateBtn").addEventListener("click",loadDay);$("saveBtn").addEventListener("click",saveDay);
  $("syncBtn").addEventListener("click",syncQueue);$("password").addEventListener("keydown",e=>{if(e.key==="Enter")login()});
  await updateQueueBadge();
  if("serviceWorker" in navigator){try{await navigator.serviceWorker.register("./sw.js")}catch(e){console.warn("SW gagal:",e)}}
  // Session token deliberately lasts only for this browser tab.
}
init().catch(e=>{console.error(e);setMessage("loginMessage","Aplikasi gagal dimulai: "+e.message,"error")});
