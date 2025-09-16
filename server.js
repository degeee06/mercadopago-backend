import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

// ======= Banco em memória (simples) =======
const vipUsers = {}; 
// Estrutura: { "email@example.com": { vip: true, valid_until: "2025-10-10T00:00:00.000Z" } }

// ======= Endpoint para compra de VIP =======
app.post("/purchase-vip", async (req, res) => {
  try {
    const { email, amount } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email obrigatório" });
    }

    // Aqui seria chamada à API do MercadoPago
    // Para teste, vamos apenas marcar o usuário como VIP por 30 dias
    const now = new Date();
    const validUntil = new Date(now.setDate(now.getDate() + 30));

    vipUsers[email] = {
      vip: true,
      valid_until: validUntil.toISOString(),
    };

    return res.json({
      message: "VIP ativado com sucesso",
      email,
      valid_until: validUntil,
    });
  } catch (e) {
    console.error("Erro no /purchase-vip:", e);
    res.status(500).json({ error: "Erro ao processar compra de VIP" });
  }
});

// ======= Endpoint para verificar VIP =======
app.get("/check-vip/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const data = vipUsers[email];

    if (!data) {
      return res.json({ vip: false });
    }

    const validUntil = new Date(data.valid_until);
    const now = new Date();

    if (validUntil > now) {
      return res.json({ vip: true, valid_until: data.valid_until });
    } else {
      // Se expirou, remove
      delete vipUsers[email];
      return res.json({ vip: false });
    }
  } catch (e) {
    console.error("Erro no /check-vip:", e);
    res.status(500).json({ error: "Erro ao checar VIP" });
  }
});

// ======= Start =======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
