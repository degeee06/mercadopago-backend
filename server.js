import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import mercadopago from "mercadopago";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Configuração Mercado Pago (SDK 2.8.0)
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN,
});

// Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Variáveis de ambiente Supabase não configuradas corretamente!");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Rota teste
app.get("/", (req, res) => res.send("Servidor MercadoPago + Supabase rodando 🚀"));

// Criar pagamento PIX (igual à API Flutter que você mandou)
app.post("/create-pix", async (req, res) => {
  try {
    const { amount, email, description } = req.body;

    if (!amount || !email) {
      return res.status(400).json({ error: "amount e email são obrigatórios" });
    }

    const paymentData = {
      transaction_amount: Number(amount),
      description: description || "Pagamento VIP",
      payment_method_id: "pix",
      payer: { email },
    };

    const result = await mercadopago.payment.create(paymentData);

    // Insere pagamento no Supabase
    await supabase.from("pagamentos").insert([
      {
        id: result.body.id.toString(), // payment.id
        email,
        amount,
        status: result.body.status,
        valid_until: null,
      },
    ]);

    res.json({
      id: result.body.id,
      qrCode: result.body.point_of_interaction.transaction_data.qr_code,
      qrImageBase64:
        result.body.point_of_interaction.transaction_data.qr_code_base64,
    });
  } catch (error) {
    console.error("Erro ao criar pagamento PIX:", error);
    res.status(500).json({ error: error.message });
  }
});

// Verifica status VIP
app.get("/check-vip/:email", async (req, res) => {
  try {
    const { email } = req.params;

    const { data, error } = await supabase
      .from("pagamentos")
      .select("valid_until")
      .eq("email", email)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error("Erro Supabase:", error);
      return res.status(500).json({ error: "Erro ao checar VIP" });
    }

    const isVip =
      data && data.valid_until && new Date(data.valid_until) > new Date();

    res.json({ vip: !!isVip });
  } catch (err) {
    console.error("Erro backend /check-vip:", err);
    res.status(500).json({ error: "Erro interno no servidor" });
  }
});

// Webhook Mercado Pago
app.post("/webhook", async (req, res) => {
  try {
    const data = req.body;

    if (data.type === "payment") {
      const paymentId = data.data.id;
      const payment = await mercadopago.payment.findById(paymentId);

      const status = payment.body.status;
      const id = payment.body.id; // sempre payment.id

      let updates = { status };

      if (status === "approved") {
        const now = new Date();
        const validUntil = new Date(now.setDate(now.getDate() + 30));
        updates.valid_until = validUntil.toISOString();
      }

      await supabase
        .from("pagamentos")
        .update(updates)
        .eq("id", id);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Erro webhook:", error);
    res.sendStatus(500);
  }
});

// Porta
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
