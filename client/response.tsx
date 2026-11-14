import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc, useSettings, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Markdown, StreamedText } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { responsesRpc, retryResponseRpc, responseDisplaySchema, translateTextRpc } from "../shared/contracts";
import { preferences } from "../shared/settings";

type Snapshot = z.infer<typeof responsesRpc.output>;
const MAX_MANUAL_ENTRIES = 128;
const manualTranslations = new Map<string, { source: string; translation: string }>();

function saveManualTranslation(key: string, source: string, translation: string) {
  manualTranslations.delete(key);
  manualTranslations.set(key, { source, translation });
  while (manualTranslations.size > MAX_MANUAL_ENTRIES) {
    const first = manualTranslations.keys().next().value;
    if (first === undefined) break;
    manualTranslations.delete(first);
  }
}

export function createResponseRenderer(scope: string) {
  return function Response({ agentId, item, host, theme }: PluginTimelineItemProps<z.infer<typeof responseDisplaySchema>>) {
    const settings = useSettings(preferences);
    const read = useRpc(responsesRpc);
    const retry = useRpc(retryResponseRpc);
    const translate = useRpc(translateTextRpc);
    const cache = useQueryClient();
    const cacheKey = JSON.stringify([host.id, agentId, item.data.messageId]);
    const [original, setOriginal] = useState(false);
    const [retrying, setRetrying] = useState(false);
    const [translating, setTranslating] = useState(false);
    const [manual, setManual] = useState<string | null>(() => {
      const saved = manualTranslations.get(cacheKey);
      return saved?.source === item.data.text ? saved.translation : null;
    });
    const [manualError, setManualError] = useState<string | null>(null);

    useEffect(() => {
      const saved = manualTranslations.get(cacheKey);
      setManual(saved?.source === item.data.text ? saved.translation : null);
      setOriginal(false);
      setManualError(null);
    }, [cacheKey, item.data.text]);

    const key = ["paseo-interaction-translator", scope, host.id, agentId, settings.status === "ready" ? settings.revision : "unavailable"];
    const enabled = item.data.phase === "complete" && settings.status === "ready" && settings.values.enabled;
    const query = useQuery({
      queryKey: key,
      enabled,
      queryFn: async (): Promise<Snapshot> => {
        const previous = cache.getQueryData<Snapshot>(key);
        const result = await read({ agentId, revision: previous?.revision });
        return result.entries === undefined && previous ? previous : result;
      },
      refetchInterval: 1500, refetchIntervalInBackground: false, retry: false, gcTime: 30000,
    });
    const state = enabled && !query.isError
      ? query.data?.entries?.find(entry => entry.messageId === item.data.messageId && entry.text === item.data.text)?.state
      : undefined;
    const availableTranslation = state?.status === "ready" ? state.text : manual;
    const text = availableTranslation && !original ? availableTranslation : item.data.text;
    const color = theme.colors.foreground;

    const requestManualTranslation = async () => {
      if (!enabled || translating) return;
      setTranslating(true);
      setManualError(null);
      try {
        const target = /[\u3400-\u9fff]/u.test(item.data.text) ? "en" : "zh-CN";
        const result = await translate({ text: item.data.text, target });
        if (!result.text.trim()) throw new Error("译文为空");
        saveManualTranslation(cacheKey, item.data.text, result.text);
        setManual(result.text);
        setOriginal(false);
      } catch {
        setManualError("翻译失败，请点击重试；原文未更改。");
      } finally {
        setTranslating(false);
      }
    };

    if (item.data.phase === "streaming") return <StreamedText text={item.data.text} phase="streaming" style={{ color }} />;
    return <View style={{ gap: 8 }}>
      <Markdown>{text}</Markdown>
      {state?.status === "translating" && <Text style={{ color: theme.colors.foregroundMuted }}>正在翻译最终答复…</Text>}
      {enabled && state?.status !== "translating" && state?.status !== "error" && <Pressable
        accessibilityRole="button"
        accessibilityLabel={availableTranslation ? (original ? "显示译文" : "查看原文") : "翻译此条消息"}
        disabled={translating}
        onPress={() => {
          if (availableTranslation) setOriginal(value => !value);
          else void requestManualTranslation();
        }}
      >
        <Text style={{ color: theme.colors.accent }}>{translating ? "翻译中…" : availableTranslation ? (original ? "显示译文" : "查看原文") : "翻译"}</Text>
      </Pressable>}
      {manualError && <View style={{ gap: 4 }}>
        <Text accessibilityRole="alert" style={{ color: theme.colors.statusWarning }}>{manualError}</Text>
        <Pressable accessibilityRole="button" onPress={() => void requestManualTranslation()}>
          <Text style={{ color: theme.colors.accent }}>重试翻译</Text>
        </Pressable>
      </View>}
      {state?.status === "error" && <View style={{ gap: 6 }}>
        <Text style={{ color: theme.colors.statusWarning }}>{state.message}</Text>
        <Pressable accessibilityRole="button" disabled={retrying} onPress={async () => {
          setRetrying(true);
          try { await retry({ agentId, messageId: item.data.messageId, text: item.data.text }); await query.refetch(); }
          catch { /* Source and existing error remain visible. */ }
          finally { setRetrying(false); }
        }}><Text style={{ color: theme.colors.accent }}>{retrying ? "重试中…" : "重试翻译"}</Text></Pressable>
      </View>}
    </View>;
  };
}
