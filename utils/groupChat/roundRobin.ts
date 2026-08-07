/**
 * Decide who speaks first for one round-robin group turn.
 *
 * A direct @mention in the latest user text wins. Otherwise the browser picks
 * one member once with Math.random; the returned order is then kept for the
 * whole turn, so later API calls never reshuffle speakers.
 */
export function resolveRoundRobinOrder<T extends { id: string; name: string }>(
    members: T[],
    latestUserText: string,
    random: () => number = Math.random,
): T[] {
    if (members.length <= 1) return [...members];

    const text = String(latestUserText ?? '');
    let mentionedIndex = -1;
    let mentionedAt = Number.POSITIVE_INFINITY;

    for (let i = 0; i < members.length; i++) {
        const name = members[i].name.trim();
        if (!name) continue;
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`[@＠]\\s*${escaped}(?=$|[\\s，。！？,.!?、:：；;~～）)\\]】}])`, 'i');
        const hit = pattern.exec(text);
        if (hit && hit.index < mentionedAt) {
            mentionedAt = hit.index;
            mentionedIndex = i;
        }
    }

    const rawRandom = Number(random());
    const safeRandom = Number.isFinite(rawRandom) ? Math.min(Math.max(rawRandom, 0), 0.999999999999) : 0;
    const firstIndex = mentionedIndex >= 0
        ? mentionedIndex
        : Math.floor(safeRandom * members.length);

    return [members[firstIndex], ...members.filter((_, index) => index !== firstIndex)];
}
