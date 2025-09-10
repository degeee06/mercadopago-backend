import express from "express";
import cors from "cors";
import mercadopago from "mercadopago";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

// 🔑 Config MercadoPago
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN,
});

// 🔑 Config Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Criar pagamento PIX
app.post("/vip/purchase", async (req, res) => {
  try {
    const { userId, plan } = req.body;

    const amount = plan === "mensal" ? 9.9 : 99.9;

    const payment = await mercadopago.payment.create({
      transaction_amount: amount,
      description: `VIP ${plan}`,
      payment_method_id: "pix",
      payer: { email: "comprador@test.com" },
    });

    // Salvar pagamento no Supabase
    await supabase.from("payments").insert({
      id: payment.response.id,
      user_id: userId,
      status: "pending",
      plan,
    });

    res.json({
      id: payment.response.id,
      pixCode: payment.response.point_of_interaction.transaction_data.qr_code,
      qrImageBase64:
        payment.response.point_of_interaction.transaction_data.qr_code_base64,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Confirmar pagamento
app.get("/vip/confirm/:paymentId", async (req, res) => {
  try {
    const { paymentId } = req.params;

    const payment = await mercadopago.payment.findById(paymentId);

    if (payment.body.status === "approved") {
      // Atualiza pagamento
      await supabase
        .from("payments")
        .update({ status: "approved" })
        .eq("id", paymentId);

      // Marca usuário como VIP
      const userId = payment.body.additional_info?.items?.[0]?.userId;

      if (userId) {
        await supabase.from("users").update({ vip: true }).eq("id", userId);
      }

      return res.json({ success: true });
    }

    res.json({ success: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verificar status VIP do usuário
app.get("/vip/status/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const { data, error } = await supabase
      .from("users")
      .select("vip")
      .eq("id", userId)
      .single();

    if (error) return res.status(400).json({ error: error.message });

    res.json({ vip: data.vip });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Server rodando na porta " + PORT));
