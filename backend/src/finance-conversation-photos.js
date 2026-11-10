import crypto from "node:crypto";
import sharp from "sharp";
import {encryptDocument,decryptDocument,validateDocument} from "./finance-ai.js";
import {fail,text} from "./finance-service.js";
import {canUseFinanceAssistant} from "../../shared/finance-workflow.mjs";

export async function uploadConversationPhoto(db,user,body){
  if(!canUseFinanceAssistant(user))fail("Tu perfil no tiene acceso a fotos del asistente",403);
  if(!["image/jpeg","image/png","image/webp"].includes(body.mime))fail("Sube una foto JPG, PNG o WebP");
  const source=validateDocument(body),sha=crypto.createHash("sha256").update(source).digest("hex");
  const previous=db.prepare("SELECT id,name,uploaded_at FROM finance_assistant_photos WHERE member_id=? AND sha256=?").get(user.id,sha);
  if(previous)return {...previous,duplicate:true};
  if(db.prepare("SELECT COUNT(*) n FROM finance_assistant_photos WHERE member_id=? AND uploaded_at>?").get(user.id,new Date(Date.now()-60000).toISOString()).n>=10)fail("Espera un momento antes de subir más fotos",429);
  let buffer;
  try{buffer=await sharp(source,{limitInputPixels:24000000}).rotate().resize({width:2048,height:2048,fit:"inside",withoutEnlargement:true}).jpeg({quality:88}).toBuffer();}catch{fail("No pude abrir esa foto. Prueba con una captura o una foto más pequeña");}
  const raced=db.prepare("SELECT id,name,uploaded_at FROM finance_assistant_photos WHERE member_id=? AND sha256=?").get(user.id,sha);
  if(raced)return {...raced,duplicate:true};
  db.prepare("DELETE FROM finance_assistant_photos WHERE uploaded_at<? AND id NOT IN (SELECT photo_id FROM finance_assistant_draft_photos) AND id NOT IN (SELECT photo_id FROM finance_assistant_photo_applications)").run(new Date(Date.now()-7*86400000).toISOString());
  const used=db.prepare("SELECT (SELECT COALESCE(SUM(bytes),0) FROM finance_evidence)+(SELECT COALESCE(SUM(bytes),0) FROM finance_assistant_photos) n").get().n;
  if(used+buffer.length>Number(process.env.FINANCE_MAX_DOCUMENT_BYTES||256*1024*1024))fail("Se alcanzó la capacidad configurada para comprobantes y fotos",413);
  const id=crypto.randomUUID(),uploaded_at=new Date().toISOString(),name=text(body.name,120)||"Foto para Gema";
  db.prepare("INSERT INTO finance_assistant_photos(id,member_id,mime,name,bytes,sha256,encrypted,uploaded_at) VALUES (?,?,?,?,?,?,?,?)").run(id,user.id,"image/jpeg",name,buffer.length,sha,encryptDocument(buffer),uploaded_at);
  return {id,name,uploaded_at};
}
export function conversationPhotos(db,user,ids=[]){
  if(!Array.isArray(ids)||ids.length>3||ids.some(id=>typeof id!=="string"))fail("Adjunta hasta tres fotos por conversación");
  return [...new Set(ids)].map(id=>{const row=db.prepare("SELECT * FROM finance_assistant_photos WHERE id=? AND member_id=?").get(id,user.id);if(!row)fail("Esta foto no está disponible para tu usuario",404);return row;});
}
export const photoInput=photo=>({type:"input_image",image_url:`data:${photo.mime};base64,${decryptDocument(photo.encrypted).toString("base64")}`,detail:"high"});
