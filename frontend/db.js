import { CONFIG } from "./config.js";

const TOKEN_KEY="vendas_pro_token_v1";
export const getToken=()=>localStorage.getItem(TOKEN_KEY)||"";
export const setToken=(t)=>localStorage.setItem(TOKEN_KEY,t);
export const clearToken=()=>localStorage.removeItem(TOKEN_KEY);

export function money(n){ return Number(n||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"}); }
export function parseMoney(s){
  if(typeof s==="number") return s;
  if(!s) return 0;
  const t=String(s).trim().replace(/\./g,"").replace(",",".").replace(/[^0-9.-]/g,"");
  const v=Number(t); return isFinite(v)?v:0;
}
export function calcMargin(p){
  const c=parseMoney(p.valorCompra), v=parseMoney(p.valorVenda);
  const m=v-c, pct=v>0?m/v:0; return {margem:m, margemPct:pct};
}
export async function api(path, opts={}){
  const url = `${CONFIG.API_BASE}${path}`;
  const headers = Object.assign({"Content-Type":"application/json"}, opts.headers||{});
  const t=getToken(); if(t) headers["Authorization"]=`Bearer ${t}`;
  const res = await fetch(url, {...opts, headers});
  const ct=res.headers.get("content-type")||"";
  const data = ct.includes("application/json") ? await res.json().catch(()=>null) : await res.text().catch(()=>null);
  if(!res.ok) throw new Error((data&&data.error)?data.error:`Erro ${res.status}`);
  return data;
}
export async function login(email, senha){
  const r = await api("/api/login",{method:"POST",body:JSON.stringify({email,senha})});
  setToken(r.token); return r;
}
export async function me(){ return api("/api/me"); }
