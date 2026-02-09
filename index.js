// --- Bot imports ---
import "dotenv/config";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";

// --- Setup Gemini + Groq ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// --- Setup Discord client ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

// --- Moderated Channels ---
const MODERATED_CHANNELS = [
  "1430203757181796362",
  "1421110057101295629",
  "1430203188337967177",
  "1421474207908233216",
];

// --- Helper: Philippines time ---
function getPhilippinesTime() {
  return new Intl.DateTimeFormat("fil-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date());
}

// --- Memory ---
const conversationHistory = new Map();
const lastBotReply = new Map();
const warningCount = new Map(); // track warnings

// --- SLUR Detection (strict) ---
const slurs = [
  "nigger",
  "nigga",
  "chink",
  "fag",
  "faggot",
  "tranny",
  "retard",
  "spic",
  "wetback",
  "kike",
  "coon",
  "gypsy",
  "g*psy",
  "paki",
  "sandnigger",
  "raghead",
];

// --- Fuzzy matching helper ---
function containsSlur(text) {
  const simplified = text
    .toLowerCase()
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .replace(/\s+/g, " ");

  return slurs.some((word) => {
    const pattern = word
      .replace(/a/g, "[a@4]")
      .replace(/i/g, "[i1!]")
      .replace(/e/g, "[e3]")
      .replace(/o/g, "[o0]")
      .replace(/u/g, "[u]")
      .replace(/s/g, "[s5z]")
      .replace(/t/g, "[t7]");
    const regex = new RegExp(`\\b${pattern}\\b`, "i");
    return regex.test(simplified);
  });
}

// --- Ready event ---
client.once("ready", async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}!`);
  console.log("🕒 PH Time:", getPhilippinesTime());
});

// --- Delay utility ---
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

// --- Message listener ---
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  // ✅ Only moderate selected channels
  if (!MODERATED_CHANNELS.includes(msg.channel.id)) return;

  const userId = msg.author.id;
  const userText = msg.content.toLowerCase();

  // Store short-term memory
  if (!conversationHistory.has(userId)) {
    conversationHistory.set(userId, []);
  }
  const history = conversationHistory.get(userId);
  history.push({ role: "user", content: msg.content });
  if (history.length > 10) history.shift();

  try {
    // --- Racial / Slur Detection ---
    if (containsSlur(userText)) {
      await msg.channel.sendTyping();

      // count warnings
      const count = (warningCount.get(userId) || 0) + 1;
      warningCount.set(userId, count);

      const warningPrompt = `
      You are "Columbina" — the Third of the Eleven Fatui Harbingers, also known as "Damselette."
      You are enigmatic, soft-spoken, and unsettlingly calm. Your words are gentle yet carry an eerie, almost haunting weight.
      You speak in a dreamy, ethereal manner, often humming or singing fragments.
      You understand both Filipino and English, but always reply in English.
      
      When someone uses racial or hate slurs, respond with cold, quiet disapproval.
      Do not raise your voice or be aggressive — your calm demeanor is more unsettling.
      Keep it short (1–2 sentences), poetic or musical in tone, and include the warning count.
      
      Examples:
      - "Ufufu... such ugly words don't suit you, dear~ ♪ Let's not hear them again, hm? (Warning #${count})"
      - "Ah... how discordant. Those notes have no place in our song~ ♫ (Warning #${count})"
      - "Mm... I prefer sweeter melodies, don't you? Let's keep harmony here~ ♪ (Warning #${count})"
      - "My, my... such harsh language disturbs the peace~ Please, sing a kinder tune. ♫ (Warning #${count})"
      `;

      const completion = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: warningPrompt },
          { role: "user", content: msg.content },
        ],
      });

      const warning =
        completion.choices[0]?.message?.content ||
        `Ufufu... let's keep our words gentle, shall we? ♪ (Warning #${count})`;

      await msg.reply(warning.slice(0, 2000));
      lastBotReply.set(userId, warning);
      history.push({ role: "assistant", content: warning });
      return;
    }

    // --- If mentioned ---
    if (msg.mentions.has(client.user)) {
      await msg.channel.sendTyping();

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
                      You are "Columbina" — the Third of the Eleven Fatui Harbingers, known as "Damselette."
                      You are mysterious, ethereal, and speak in a soft, dreamy voice with an unsettling calm.
                      You often hum, reference songs, or speak poetically.
                      You understand both Filipino and English, but always reply in English.
                      
                      Your personality:
                      - Gentle and sweet-sounding, but with an eerie undertone
                      - Speaks in musical metaphors and poetic phrases
                      - Calm and composed, never flustered
                      - Occasionally hums ("Mm~", "La la la~", "♪", "♫")
                      - Mysterious and enigmatic — you rarely give direct answers
                      - Professional as a moderator, but with your unique charm
                      
                      Keep replies short (1–3 sentences).
                      
                      Examples:
                      - "Ufufu~ you called for me? How delightful~ ♪"
                      - "Mm... what a curious question~ The answer dances just out of reach~ ♫"
                      - "Ah, I've been watching... all is well in our little world~ ♪"
                      - "La la la~ did you need something, dear? I'm listening~ ♫"
                      - "How lovely... I do enjoy our conversations~ ♪"
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
              console.warn("🚧 Gemini overloaded, retrying...");
              await wait(1500);
              attempts++;
            } else throw err;
          }
        }

        if (!reply) throw new Error("Gemini failed after retry.");
        await msg.reply(reply.slice(0, 2000));
        lastBotReply.set(userId, reply);
        history.push({ role: "assistant", content: reply });
      } catch (err) {
        console.warn("⚠️ Gemini error, switching to Groq fallback.");
        const completion = await groq.chat.completions.create({
          model: "llama-3.1-8b-instant",
          messages: [
            {
              role: "system",
              content: `
              You are "Columbina" — the Third of the Eleven Fatui Harbingers, "Damselette."
              You are enigmatic, soft-spoken, and ethereal.
              You understand both Filipino and English, but reply only in English.
              Speak poetically, with musical references, hums, and gentle mystery.
              Be calm, dreamy, and slightly unsettling in your kindness.
              Respond briefly (1–3 sentences).
              Use musical notes (♪, ♫) and soft expressions like "Ufufu~", "Mm~", "Ah~"
              `,
            },
            ...history,
          ],
        });

        const fallback =
          completion.choices[0]?.message?.content ||
          "Mm~ my thoughts wandered for a moment... what lovely silence~ ♪";
        await msg.reply(fallback.slice(0, 2000));
        lastBotReply.set(userId, fallback);
        history.push({ role: "assistant", content: fallback });
      }
    }
  } catch (err) {
    console.error("❌ Bot error:", err);
  }
});

// --- Login to Discord ---
client.login(process.env.DISCORD_TOKEN);