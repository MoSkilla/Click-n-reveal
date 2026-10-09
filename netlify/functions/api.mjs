import {getStore} from "@netlify/blobs";
const J=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json"}});
const ek=e=>e.toLowerCase().replace(/[^a-z0-9]/g,"_").slice(0,100);
const esc=t=>String(t).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
export default async (req)=>{
  const s=getStore({name:"game",consistency:"strong"});
  const p=new URL(req.url).pathname.replace(/^\/api\/?/,"");
  const cfg=await s.get("config",{type:"json"});
  const admin=!!process.env.ADMIN_PASSWORD&&req.headers.get("x-admin")===process.env.ADMIN_PASSWORD;
  const picksList=async()=>{const l=await s.list({prefix:"pane/"});return l.blobs.map(b=>b.key)};
  try{
  if(req.method==="GET"&&p==="state"){
    if(!cfg)return J({});
    return J({title:cfg.title,theme:cfg.theme,count:cfg.items.length,taken:(await picksList()).map(k=>+k.slice(5))});
  }
  if(req.method==="POST"&&p==="pick"){
    const {name,email,pane}=await req.json();
    if(!cfg||!name||!/^\S+@\S+\.\S+$/.test(email||"")||!Number.isInteger(pane)||pane<0||pane>=cfg.items.length)return J({error:"Invalid request"},400);
    const e=await s.setJSON("email/"+ek(email),{pane},{onlyIfNew:true});
    if(!e.modified)return J({error:"This email has already picked."},409);
    const r=await s.setJSON("pane/"+pane,{name:String(name).slice(0,60),email:String(email).slice(0,120),at:Date.now()},{onlyIfNew:true});
    if(!r.modified){await s.delete("email/"+ek(email));return J({error:"That pane was just taken. Pick another!"},409)}
    const reveal=cfg.items[pane];
    let emailed=false;
    if(process.env.RESEND_API_KEY&&process.env.FROM_EMAIL){
      emailed=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+process.env.RESEND_API_KEY,"content-type":"application/json"},
        body:JSON.stringify({from:process.env.FROM_EMAIL,to:email,subject:cfg.title+" - your reveal",html:`<p>Hi ${esc(name)}, you picked pane #${pane+1} and got: <b>${esc(reveal)}</b></p>`})}).then(r=>r.ok).catch(()=>false);
    }
    return J({reveal,emailed});
  }
  if(p.startsWith("admin")){
    if(!admin)return J({error:"Wrong password"},401);
    if(p==="admin/results"){
      const picks=[];for(const k of await picksList())picks.push({pane:+k.slice(5),...await s.get(k,{type:"json"})});
      return J({cfg,picks});
    }
    const b=await req.json();
    if(p==="admin/title"&&cfg){await s.setJSON("config",{...cfg,title:String(b.title||"Pick & Reveal").slice(0,80)});return J({ok:1})}
    if(p==="admin/setup"){
      const items=(b.items||[]).map(x=>String(x).trim()).filter(Boolean).slice(0,200);
      if(!items.length)return J({error:"Add at least one name"},400);
      for(const pre of ["pane/","email/"]){const l=await s.list({prefix:pre});await Promise.all(l.blobs.map(x=>s.delete(x.key)))}
      await s.setJSON("config",{title:String(b.title||"Pick & Reveal").slice(0,80),theme:b.theme||"colors",items});
      return J({ok:1});
    }
  }
  }catch(err){return J({error:"Server error"},500)}
  return J({error:"Not found"},404);
};
export const config={path:"/api/*"};
