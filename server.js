// server.js
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import mercadopago from "mercadopago";

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 🔑 Token vem do ENV (Render/Railway)
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN,
});

// 👉 Criar pagamento PIX
app.post("/create-payment", async (req, res) => {
  try {
    const { email, amount } = req.body;

    const payment_data = {
      transaction_amount: parseFloat(amount),
      description: "Compra de VIP",
      payment_method_id: "pix",
      payer: {
        email,
      },
    };

    const payment = await mercadopago.payment.create(payment_data);

    const qrCodeBase64 =
      payment.body.point_of_interaction?.transaction_data?.qr_code_base64 || "";
    const pixCode =
      payment.body.point_of_interaction?.transaction_data?.qr_code || "";

    return res.json({
      id: payment.body.id,
      status: payment.body.status,
      qrImageBase64: qrCodeBase64,
      pixCode,
    });
  } catch (error) {
    console.error("Erro ao criar pagamento:", error);
    return res
      .status(500)
      .json({ error: "Erro ao criar pagamento", details: error.message });
  }
});

// 👉 Verificar status do pagamento por email
app.get("/check-vip", async (req, res) => {
  try {
    const { email } = req.query;

    const search = await mercadopago.payment.search({
      qs: {
        limit: 5,
        offset: 0,
        sort: "date_created",
        criteria: "desc",
        external_reference: email,
      },
    });

    const payments = search.body.results || [];
    const lastPayment = payments[0];

    if (lastPayment && lastPayment.status === "approved") {
      return res.json({ vip: true });
    } else {
      return res.json({ vip: false });
    }
  } catch (error) {
    console.error("Erro ao verificar VIP:", error);
    return res
      .status(500)
      .json({ error: "Erro ao verificar VIP", details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
