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

export function useSpeechRecognition() {
    const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
    const finalTranscriptRef = useRef('');
    const liveTranscriptRef = useRef('');
    const [transcript, setTranscript] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isSupported, setIsSupported] = useState(false);
    const [permissionState, setPermissionState] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle');

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
            setError(event.message ?? event.error ?? 'Speech recognition failed.');
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

    const reset = useCallback(() => {
        finalTranscriptRef.current = '';
        liveTranscriptRef.current = '';
        setTranscript('');
        setError(null);
    }, []);

    const requestMicrophonePermission = useCallback(async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
            return true;
        }
        setPermissionState('requesting');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach((track) => track.stop());
            setPermissionState('granted');
            return true;
        } catch {
            setPermissionState('denied');
            setError('Microphone permission was blocked. Allow microphone access in the browser, then try again.');
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
