'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type SpeechRecognitionAlternative = {
    transcript: string;
};

type SpeechRecognitionResult = {
    isFinal: boolean;
    0: SpeechRecognitionAlternative;
};

type SpeechRecognitionResultList = {
    length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
};

type SpeechRecognitionEventLike = {
    resultIndex: number;
    results: SpeechRecognitionResultList;
};

type SpeechRecognitionLike = {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onstart: (() => void) | null;
    onresult: ((event: SpeechRecognitionEventLike) => void) | null;
    onerror: ((event: { error?: string; message?: string }) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechWindow = Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

type MicrophonePermissionState = 'idle' | 'prompt' | 'requesting' | 'granted' | 'denied' | 'unavailable';

export function useSpeechRecognition() {
    const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
    const permissionStatusRef = useRef<PermissionStatus | null>(null);
    const finalTranscriptRef = useRef('');
    const liveTranscriptRef = useRef('');
    const [transcript, setTranscript] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isSupported, setIsSupported] = useState(false);
    const [permissionState, setPermissionState] = useState<MicrophonePermissionState>('idle');

    useEffect(() => {
        const speechWindow = window as SpeechWindow;
        const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
        setIsSupported(Boolean(Recognition));
        if (!Recognition) return;

        const recognition = new Recognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        recognition.onstart = () => {
            setIsListening(true);
            setError(null);
        };
        recognition.onresult = (event) => {
            let interim = '';
            for (let index = event.resultIndex; index < event.results.length; index += 1) {
                const result = event.results[index] ?? event.results.item(index);
                const text = result?.[0]?.transcript ?? '';
                if (result?.isFinal) {
                    finalTranscriptRef.current = `${finalTranscriptRef.current} ${text}`.trim();
                } else {
                    interim = `${interim} ${text}`.trim();
                }
            }
            const nextTranscript = `${finalTranscriptRef.current} ${interim}`.trim();
            liveTranscriptRef.current = nextTranscript;
            setTranscript(nextTranscript);
        };
        recognition.onerror = (event) => {
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                setPermissionState('denied');
                setError('Microphone permission is blocked for this site.');
            } else if (event.error === 'no-speech') {
                setError('No speech was detected. Try again in a quieter space.');
            } else {
                setError(event.message ?? event.error ?? 'Speech recognition failed.');
            }
            setIsListening(false);
        };
        recognition.onend = () => {
            setIsListening(false);
        };
        recognitionRef.current = recognition;

        return () => {
            recognition.onstart = null;
            recognition.onresult = null;
            recognition.onerror = null;
            recognition.onend = null;
            recognition.abort();
            recognitionRef.current = null;
        };
    }, []);

    useEffect(() => {
        let disposed = false;

        async function readMicrophonePermission() {
            if (!navigator.mediaDevices?.getUserMedia) {
                setPermissionState('unavailable');
                return;
            }
            if (!navigator.permissions?.query) {
                return;
            }
            try {
                const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
                if (disposed) return;
                permissionStatusRef.current = status;
                setPermissionState(normalizeMicrophonePermission(status.state));
                status.onchange = () => {
                    setPermissionState(normalizeMicrophonePermission(status.state));
                };
            } catch {
                // Some browsers do not expose microphone permission through the Permissions API.
            }
        }

        void readMicrophonePermission();

        return () => {
            disposed = true;
            if (permissionStatusRef.current) {
                permissionStatusRef.current.onchange = null;
                permissionStatusRef.current = null;
            }
        };
    }, []);

    const reset = useCallback(() => {
        finalTranscriptRef.current = '';
        liveTranscriptRef.current = '';
        setTranscript('');
        setError(null);
    }, []);

    const requestMicrophonePermission = useCallback(async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
            setPermissionState('unavailable');
            setError('Microphone capture is not available in this browser. Use Chrome or Edge over HTTPS.');
            return false;
        }
        if (!window.isSecureContext) {
            setPermissionState('unavailable');
            setError('Microphone access requires HTTPS or localhost. Open VetIOS on https://www.vetios.tech and try again.');
            return false;
        }
        setPermissionState('requesting');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach((track) => track.stop());
            setPermissionState('granted');
            setError(null);
            return true;
        } catch (microphoneError) {
            const blocked = isPermissionDeniedError(microphoneError);
            setPermissionState(blocked ? 'denied' : 'unavailable');
            setError(describeMicrophoneError(microphoneError));
            return false;
        }
    }, []);

    const start = useCallback(async () => {
        if (!recognitionRef.current) {
            setError('Voice input is not supported by this browser.');
            return;
        }
        reset();
        const allowed = await requestMicrophonePermission();
        if (!allowed) return;
        try {
            recognitionRef.current.start();
        } catch {
            setError('Microphone capture could not start. Check browser permission and try again.');
            setIsListening(false);
        }
    }, [requestMicrophonePermission, reset]);

    const stop = useCallback(() => {
        recognitionRef.current?.stop();
        setIsListening(false);
    }, []);

    const getTranscript = useCallback(() => liveTranscriptRef.current.trim(), []);

    return {
        transcript,
        isListening,
        isSupported,
        isRequestingPermission: permissionState === 'requesting',
        permissionState,
        error,
        start,
        stop,
        getTranscript,
        reset,
    };
}

function normalizeMicrophonePermission(state: PermissionState): MicrophonePermissionState {
    if (state === 'granted' || state === 'denied' || state === 'prompt') {
        return state;
    }
    return 'idle';
}

function isPermissionDeniedError(error: unknown) {
    if (!(error instanceof DOMException)) {
        return false;
    }
    return error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError' || error.name === 'SecurityError';
}

function describeMicrophoneError(error: unknown) {
    if (!(error instanceof DOMException)) {
        return 'Microphone permission could not be opened. Check browser permission and try again.';
    }

    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError' || error.name === 'SecurityError') {
        return 'Microphone access was denied or is already blocked for VetIOS. If no Allow/Block prompt appeared, unblock vetios.tech in browser site settings and reload.';
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        return 'No microphone was found. Connect or enable a microphone, then try again.';
    }
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        return 'The microphone is already in use by another app or browser tab. Close the other app, then try again.';
    }
    if (error.name === 'OverconstrainedError') {
        return 'The selected microphone cannot satisfy the browser audio request. Choose another input device and try again.';
    }
    return error.message || 'Microphone permission could not be opened. Check browser permission and try again.';
}
