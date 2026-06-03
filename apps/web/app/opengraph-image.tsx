import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'VetIOS veterinary AI infrastructure';
export const size = {
    width: 1200,
    height: 630,
};
export const contentType = 'image/png';

export default function Image() {
    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    background: '#06110f',
                    color: '#f8fffd',
                    padding: '72px',
                    fontFamily: 'Arial, sans-serif',
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: 24,
                        color: '#6bf7cf',
                        letterSpacing: 0,
                    }}
                >
                    <span>VetIOS</span>
                    <span>AI-Native Veterinary Intelligence Infrastructure</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                    <div
                        style={{
                            maxWidth: 940,
                            fontSize: 74,
                            fontWeight: 700,
                            lineHeight: 1.02,
                            letterSpacing: 0,
                        }}
                    >
                        Veterinary AI infrastructure for clinical intelligence.
                    </div>
                    <div
                        style={{
                            maxWidth: 900,
                            fontSize: 32,
                            lineHeight: 1.35,
                            color: 'rgba(248,255,253,0.72)',
                        }}
                    >
                        Inference, outcome learning, graph intelligence, simulation, and quantum-ready AMR research.
                    </div>
                </div>
                <div
                    style={{
                        display: 'flex',
                        gap: 18,
                        fontSize: 24,
                        color: '#d9fff5',
                    }}
                >
                    <span>vetios.tech</span>
                    <span>/</span>
                    <span>Veterinary AI</span>
                    <span>/</span>
                    <span>Diagnostic intelligence</span>
                </div>
            </div>
        ),
        size,
    );
}
