<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>PIX Mercado Pago</title>
</head>
<body>
  <h1>Gerar PIX Sandbox</h1>
  <input type="number" id="amount" placeholder="Valor (R$)" />
  <button onclick="gerarPix()">Gerar QR</button>

  <div id="qr" style="margin-top:20px;"></div>
  <button id="copiar" style="display:none;" onclick="copiarPix()">Copiar Código PIX</button>

  <script>
    async function gerarPix() {
      const amount = document.getElementById("amount").value;
      if(!amount) return alert("Digite um valor!");

      const res = await fetch("/create-pix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, description: "Teste VIP", email: "teste@cliente.com" })
      });

      const data = await res.json();

      document.getElementById("qr").innerHTML = `<img src="data:image/png;base64,${data.qr_code_base64}" />`;
      document.getElementById("copiar").style.display = "block";
      window.qrString = data.qr_code;
    }

    function copiarPix() {
      navigator.clipboard.writeText(window.qrString);
      alert("Código PIX copiado!");
    }
  </script>
</body>
</html>
