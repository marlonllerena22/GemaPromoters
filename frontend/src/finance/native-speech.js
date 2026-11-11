import {Capacitor,registerPlugin} from '@capacitor/core';
const speech=registerPlugin('FinanceSpeech');
export const hasNativeDictation=()=>Capacitor.isNativePlatform();
export async function dictateNative(){
  if(!Capacitor.isPluginAvailable('FinanceSpeech'))throw new Error('Actualiza Gema Finanzas a la APK 1.1.2 para activar el micrófono.');
  const result=await speech.start();
  return result.cancelled?'':String(result.text||'').trim();
}
