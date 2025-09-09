import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar __dirname com ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Servir arquivos estáticos da pasta 'public'
app.use(express.static(path.join(__dirname, "public")));

// Configuração do body-parser
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Rota de teste do backend
app.get("/api/test", (req, res) => {
  res.json({ message: "Backend funcionando!" });
});

// Exemplo de rota de pagamento Pix Mercado Pago
app.post("/api/pix", async (req, res) => {
  const { amount, description } = req.body;

  try {
    const response = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer TEST-6172816457651620-090719-ef2ac7e7628cc5b8a64d2ca1ddf89c61-469548398`,
      },
      body: JSON.stringify({
        transaction_amount: amount,
        description: description,
        payment_method_id: "pix",
        payer: {
          email: "teste@teste.com",
        },
      }),
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Servir index.html em qualquer rota não encontrada (opcional)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
