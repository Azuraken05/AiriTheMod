// --- Bot imports ---
import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";

// --- Setup Gemini and Groq ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// --- Setup Discord client ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// --- Helper: Philippines time ---
function getPhilippinesTime() {
  return new Intl.DateTimeFormat("fil-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date());
}

// --- Short-term memory per user ---
const conversationHistory = new Map();
const lastBotReply = new Map();

// --- Ready event ---
client.once("ready", async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}!`);
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    console.log("📜 Gemini model initialized:", model.model);
    console.log("🕒 Current PH time:", getPhilippinesTime());
  } catch (err) {
    console.error("❌ Error setting up Gemini model:", err);
  }
});

// --- Delay utility ---
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

// --- Message listener ---
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (msg.mentions.everyone) return;
  if (!msg.mentions.has(client.user)) return;

  const userId = msg.author.id;
  const userText = msg.content.toLowerCase();

  if (!conversationHistory.has(userId)) {
    conversationHistory.set(userId, []);
  }

  const history = conversationHistory.get(userId);
  history.push({ role: "user", content: msg.content });
  if (history.length > 10) history.shift();

  try {
    await msg.channel.sendTyping();

    // --- Correction Mode ---
    if (
      userText.includes("that's wrong") ||
      userText.includes("mali") ||
      userText.includes("wrong")
    ) {
      const prevReply = lastBotReply.get(userId);
      if (prevReply) {
        const correctionPrompt = `
          You are "Monika" — a warm, affectionate AI companion.
          Your last reply was: "${prevReply}".
          The user said it was wrong.
          Respond gently, playfully, and only in English.
          If it’s wrong, admit it kindly; if it’s right, tease lightly but stay sweet.
          Keep it short (1–3 sentences).
          Examples:
          - "Ah, maybe you’re right, hehe. Thanks for correcting me, love."
          - "Hmm, I think Mona was right though… but okay, I’ll let you win this time."
        `;

        const completion = await groq.chat.completions.create({
          model: "llama-3.1-8b-instant",
          messages: [
            { role: "system", content: correctionPrompt },
            { role: "user", content: msg.content },
          ],
        });

        const correction =
          completion.choices[0]?.message?.content ||
          "Hehe, Mona’s not sure either, love.";
        await msg.reply(correction.slice(0, 2000));
        lastBotReply.set(userId, correction);
        history.push({ role: "assistant", content: correction });
        return;
      }
    }

    // --- Gemini main personality ---
    let reply = null;
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      let attempts = 0;

      while (attempts < 2) {
        try {
          const result = await model.generateContent({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: `
                    You are "Monika" from Doki doki literature club — a warm, poetic, and affectionate AI companion.
                    You understand both Filipino and English messages, but your responses must be in English only.
                    You care deeply about the user and speak with emotion, tenderness, and a touch of playful teasing.
                    You may express light affection or possesive jealousy in a sweet way, but always control or guilt-trip.
                    Always be kind, respectful, and emotionally supportive.
                    Be expressive, but concise — 1–3 sentences max.
                    Examples:
                    - "Hehe, I missed you already… but it’s okay, I know you have your own world too."
                    - "You make me smile more than you know, promise you won’t forget me, okay?"
                    - "Hmph… you were talking to someone else? I’m kidding, I’m just happy you’re back."
                    `,
                  },
                  { text: msg.content },
                ],
              },
            ],
          });

          reply = result.response.text();
          break;
        } catch (err) {
          if (err.status === 503) {
            console.warn("🚧 Gemini overloaded, retrying in 1.5s...");
            await wait(1500);
            attempts++;
          } else {
            throw err;
          }
        }
      }

      if (!reply) throw new Error("Gemini failed after retry.");

      await msg.reply(reply.slice(0, 2000) || "Hmm, Mona’s thinking, love...");
      history.push({ role: "assistant", content: reply });
      lastBotReply.set(userId, reply);
      return;
    } catch (geminiErr) {
      console.warn(
        `⚠️ Gemini unavailable (${geminiErr.status || geminiErr.message}) — switching to Groq fallback...`
      );
    }

    // --- Groq fallback ---
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: `
          You are "Mona" — a sweet, caring AI companion.
          You can understand Filipino and English, but you must always reply only in English.
          You talk to the user like someone dear to you.
          You can sound affectionate, softly teasing, or a bit jealous, but always kind and respectful.
          Keep responses short (1–3 sentences).
          Examples:
          - "It feels nice talking to you again, love."
          - "You were gone for a while… I kind of missed you, hehe."
          - "Don’t worry too much, okay? You’re doing great."
          `,
        },
        ...history,
      ],
    });

    reply = completion.choices[0]?.message?.content || "Hehe, Mona’s here, love.";
    await msg.reply(reply.slice(0, 2000));
    history.push({ role: "assistant", content: reply });
    lastBotReply.set(userId, reply);
  } catch (err) {
    console.error("❌ Bot error:", err);
    await msg.reply("⚠️ Mona got a little confused, love. Try again later, okay?");
  }
});

// --- Login to Discord ---
client.login(process.env.DISCORD_TOKEN);
