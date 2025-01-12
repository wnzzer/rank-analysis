// src/types/preload.d.ts

export {};

declare global {
    interface Window {
        api: {
            OpenGithub: () => void;
        };
    }
}
