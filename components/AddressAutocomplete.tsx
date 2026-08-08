"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    google?: any;
    __gmapsPromise?: Promise<void>;
  }
}

function loadMaps(key: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.maps?.places) return Promise.resolve();
  if (!window.__gmapsPromise) {
    window.__gmapsPromise = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places`;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => reject();
      document.head.appendChild(s);
    });
  }
  return window.__gmapsPromise;
}

/**
 * Address field with Google Places autocomplete. Controlled by the parent.
 * If NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set (or Google fails to load),
 * it silently behaves as a normal pair of address + city inputs.
 */
export default function AddressAutocomplete({
  value,
  city,
  onChange,
  onCity,
  addressName = "address",
  cityName = "city",
  placeholder = "Start typing an address…",
}: {
  value: string;
  city: string;
  onChange: (v: string) => void;
  onCity: (v: string) => void;
  addressName?: string;
  cityName?: string;
  placeholder?: string;
}) {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const ref = useRef<HTMLInputElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!key || !ref.current) return;
    let ac: any;
    loadMaps(key)
      .then(() => {
        if (!ref.current || !window.google?.maps?.places) return;
        ac = new window.google.maps.places.Autocomplete(ref.current, {
          types: ["address"],
          fields: ["address_components", "formatted_address"],
        });
        ac.addListener("place_changed", () => {
          const p = ac.getPlace();
          const comp = p?.address_components ?? [];
          const get = (t: string) => comp.find((c: any) => c.types.includes(t))?.long_name ?? "";
          const street = [get("street_number"), get("route")].filter(Boolean).join(" ");
          const town =
            get("locality") ||
            get("postal_town") ||
            get("sublocality") ||
            get("administrative_area_level_2");
          onChange(street || p?.formatted_address || "");
          if (town) onCity(town);
        });
        setReady(true);
      })
      .catch(() => {});
    return () => {
      if (ac && window.google?.maps?.event) window.google.maps.event.clearInstanceListeners(ac);
    };
  }, [key]); // eslint-disable-line

  return (
    <div>
      <input
        ref={ref}
        name={addressName}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        style={inp}
      />
      <input
        name={cityName}
        value={city}
        onChange={(e) => onCity(e.target.value)}
        placeholder="City"
        aria-label="City"
        style={{ ...inp, marginTop: 8 }}
      />
      {key && ready && (
        <div style={{ fontSize: "0.875rem", color: "#94a3b8", marginTop: 4 }}>
          📍 Powered by Google — pick a suggestion to auto-fill.
        </div>
      )}
    </div>
  );
}

const inp: React.CSSProperties = {
  width: "100%",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: "11px 12px",
  fontSize: "1rem",
  outline: "none",
};
