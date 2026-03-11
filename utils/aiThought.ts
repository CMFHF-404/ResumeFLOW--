export const extractThoughtHeadline = (summary?: string | null) => {
    const text = summary?.trim();
    if (!text) {
        return '';
    }

    const boldMatch = text.match(/\*\*([^*\n]+?)(?:\*\*|$)/);
    if (boldMatch?.[1]) {
        return boldMatch[1].trim();
    }

    const firstLine = text
        .split('\n')
        .map((line) => line.replace(/\*/g, '').trim())
        .find(Boolean);

    return firstLine ?? '';
};
