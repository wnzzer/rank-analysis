// src/types/preload.d.ts

declare global {
    interface Window {
        api: {
            OpenGithub: () => void;
        };
    }
}
