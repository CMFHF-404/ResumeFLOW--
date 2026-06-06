export const devLog = (...args: Parameters<typeof console.log>) => {
    if (import.meta.env.DEV) {
        console.log(...args);
    }
};
