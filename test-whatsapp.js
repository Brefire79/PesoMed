// Teste da função whatsappShareUrl
function testWhatsAppUrl() {
  const testText = "Olá! Este é um teste do DoseCheck.";
  
  // Simular User Agent de celular
  const originalUA = navigator.userAgent;
  
  console.log("=== TESTE WHATSAPP URL ===");
  console.log("User Agent atual:", navigator.userAgent);
  
  // Função melhorada
  function whatsappShareUrl(text) {
    const msg = String(text || '');
    if (/Android|iPhone|iPad|iPod/.test(navigator.userAgent)) {
      return `whatsapp://send?text=${encodeURIComponent(msg)}`;
    } else {
      return `https://web.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
    }
  }
  
  const url = whatsappShareUrl(testText);
  console.log("URL gerada:", url);
  
  if (/Android|iPhone|iPad|iPod/.test(navigator.userAgent)) {
    console.log("✅ Celular detectado - usando scheme nativo: whatsapp://send");
  } else {
    console.log("💻 Desktop detectado - usando WhatsApp Web");
  }
  
  console.log("\nComo testar no celular:");
  console.log("1. Abra o DevTools do navegador (F12)");
  console.log("2. Clique nos três pontos > More tools > Developer tools");
  console.log("3. Clique no ícone do telefone (Ctrl+Shift+M)");
  console.log("4. Recarregue a página (F5)");
  console.log("5. Clique em qualquer botão 'Enviar para WhatsApp'");
  console.log("6. Você verá a URL correta no console");
}

testWhatsAppUrl();
