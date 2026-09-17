import { useEffect, useRef } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  baseAlpha: number;
  phase: number;
}

interface AmbientCanvasProps {
  className?: string;
  particleCount?: number;
  accentColor?: string;
  secondaryColor?: string;
}

export function AmbientCanvas({
  className = '',
  particleCount = 42,
  accentColor = '#25d366',
  secondaryColor = '#06b6d4',
}: AmbientCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = canvas.parentElement?.clientWidth || window.innerWidth);
    let height = (canvas.height = canvas.parentElement?.clientHeight || window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.parentElement?.clientWidth || window.innerWidth;
      height = canvas.height = canvas.parentElement?.clientHeight || window.innerHeight;
    };

    window.addEventListener('resize', handleResize);

    const colors = [accentColor, secondaryColor, '#10b981', '#3b82f6'];
    const particles: Particle[] = Array.from({ length: particleCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.45,
      vy: (Math.random() - 0.5) * 0.45,
      size: Math.random() * 2.5 + 1.2,
      color: colors[Math.floor(Math.random() * colors.length)],
      baseAlpha: Math.random() * 0.45 + 0.2,
      phase: Math.random() * Math.PI * 2,
    }));

    let tick = 0;

    const render = () => {
      tick += 0.015;
      ctx.clearRect(0, 0, width, height);

      // Draw subtle ambient luminous orb gradients
      const orbGrad = ctx.createRadialGradient(
        width * 0.2 + Math.sin(tick * 0.5) * 60,
        height * 0.3 + Math.cos(tick * 0.4) * 50,
        10,
        width * 0.2,
        height * 0.3,
        width * 0.45,
      );
      orbGrad.addColorStop(0, 'rgba(37, 211, 102, 0.08)');
      orbGrad.addColorStop(0.6, 'rgba(18, 140, 126, 0.02)');
      orbGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = orbGrad;
      ctx.fillRect(0, 0, width, height);

      const orbGrad2 = ctx.createRadialGradient(
        width * 0.8 + Math.cos(tick * 0.3) * 70,
        height * 0.7 + Math.sin(tick * 0.5) * 60,
        10,
        width * 0.8,
        height * 0.7,
        width * 0.4,
      );
      orbGrad2.addColorStop(0, 'rgba(6, 182, 212, 0.07)');
      orbGrad2.addColorStop(0.7, 'rgba(59, 130, 246, 0.015)');
      orbGrad2.addColorStop(1, 'transparent');
      ctx.fillStyle = orbGrad2;
      ctx.fillRect(0, 0, width, height);

      // Connect nearby particles with luminous lines
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.hypot(dx, dy);
          if (dist < 110) {
            const alpha = (1 - dist / 110) * 0.18;
            ctx.strokeStyle = `rgba(37, 211, 102, ${alpha})`;
            ctx.lineWidth = 0.85;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }

      // Update and draw particles
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;

        // Subtle mouse influence
        if (mouseRef.current.active) {
          const mdx = mouseRef.current.x - p.x;
          const mdy = mouseRef.current.y - p.y;
          const mdist = Math.hypot(mdx, mdy);
          if (mdist < 140 && mdist > 5) {
            const force = (1 - mdist / 140) * 0.6;
            p.x += (mdx / mdist) * force;
            p.y += (mdy / mdist) * force;
          }
        }

        // Screen wrap
        if (p.x < -10) p.x = width + 10;
        else if (p.x > width + 10) p.x = -10;
        if (p.y < -10) p.y = height + 10;
        else if (p.y > height + 10) p.y = -10;

        const pulse = Math.sin(tick + p.phase) * 0.25 + 0.75;
        const currentAlpha = p.baseAlpha * pulse;

        ctx.fillStyle = p.color;
        ctx.globalAlpha = currentAlpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();

        // Glow ring for larger particles
        if (p.size > 2.5) {
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = currentAlpha * 0.4;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      ctx.globalAlpha = 1.0;
      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        active: true,
      };
    };

    const onMouseLeave = () => {
      mouseRef.current.active = false;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseleave', onMouseLeave);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [particleCount, accentColor, secondaryColor]);

  return (
    <canvas
      ref={canvasRef}
      className={`ambient-canvas ${className}`}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
      aria-hidden="true"
    />
  );
}
