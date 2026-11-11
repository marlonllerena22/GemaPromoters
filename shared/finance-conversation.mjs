export function cancelsConversation(value){
  const text=String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[.!¡¿?,;:]/g,' ').replace(/\s+/g,' ').trim();
  return /^(?:(?:por favor|ok|bueno) )?(?:ya basta|basta|cancelar?|cancela(?:lo|r)?|olvida(?:lo)?|dejalo|para|detente|no hagas nada|no registres nada|no guardes nada|no quiero (?:seguir|continuar))(?: por favor)?$/.test(text);
}
