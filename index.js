<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Pagamento VIP - Pix</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; }
    input, button { padding: 8px; margin: 5px 0; width: 100%; box-sizing: border-box; }
    #qr { margin-top: 20px; text-align: center; }
    img { width: 250px; height: 250px; }
    .vip-status { margin-top: 20px; font-weight: bold; }
  </style>
</head>
<body>
  <h1>Pagamento VIP - Pix</h1>

  <label>User ID:</label>
  <input type="text" id="userId" placeholder="Digite seu ID de usuário">

  <label>Valor (R$):</label>
  <input type="number" id="valor" placeholder="Ex: 10.50" step="0.01">

  <button id="gerarPix">Gerar Pix</button>

  <div id="qr"></div>

  <button id="checarVip" style="display:none;">Checar VIP</button>
  <div class="vip-status" id="vipStatus"></div>

  <script src="https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js"></script>
  <script>
    const gerarBtn = document.getElementById("gerarPix");
    const checarBtn = document.getElementById("checarVip");
    const qrDiv = document.getElementById("qr");
    const vipStatus = document.getElementById("vipStatus");

    gerarBtn.onclick = async () => {
      const userId = document.getElementById("userId").value.trim();
      const valor = parseFloat(document.getElementById("valor").value);

      if(!userId || !valor) { alert("Preencha userId e valor"); return; }

      try {
        const res = await fetch("/criar-pix", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, valor })
        });

        const data = await res.json();
        if(data.error) { alert(data.error); return; }

        // Gerar QR code visual
        qrDiv.innerHTML = "";
        QRCode.toCanvas(data.pix_code, { width: 250 }, (err, canvas) => {
          if(err) return console.error(err);
          qrDiv.appendChild(canvas);
        });

        checarBtn.style.display = "block";
        vipStatus.textContent = "";
      } catch(e) {
        alert("Erro ao gerar Pix: " + e.message);
      }
    };

    checarBtn.onclick = async () => {
      const userId = document.getElementById("userId").value.trim();
      if(!userId) return;

      try {
        const res = await fetch(`/vip/${userId}`);
        const data = await res.json();
        vipStatus.textContent = data.vip ? "✅ Usuário VIP liberado!" : "⏳ Aguardando pagamento...";
      } catch(e) {
        vipStatus.textContent = "Erro ao checar VIP";
      }
    };
  </script>
</body>
</html>
