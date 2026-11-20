import { useEffect, useState } from 'react'
import { imageUrl } from '../lib/localStore.js'
import { getProviders } from '../lib/movies.js'

const GROUPS = [['stream', 'Stream'], ['rent', 'Rent'], ['buy', 'Buy']]

// Where to watch a movie in the US: the services that stream it, rent it and sell
// it, as logos. Each logo goes to TMDb's page, which links to the service. Shows
// nothing while loading, when no service has it, or when the lookup fails.
export default function WhereToWatch({ tmdbId }) {
  // Keyed by movie, so an answer for a previous movie is never shown.
  const [loaded, setLoaded] = useState(null)

  useEffect(() => {
    let current = true
    getProviders(tmdbId).then(
      (found) => current && setLoaded({ tmdbId, found }),
      () => {},
    )
    return () => {
      current = false
    }
  }, [tmdbId])

  const info = loaded?.tmdbId === tmdbId ? loaded.found : null

  const groups = GROUPS.filter(([key]) => info?.[key]?.length)
  if (!groups.length) return null

  return (
    <section className="watchwhere" aria-label="Where to watch">
      <h3 className="watchwhere__title">Where to watch</h3>
      {groups.map(([key, label]) => (
        <div key={key} className="watchwhere__group">
          <span className="watchwhere__label">{label}</span>
          <ul className="watchwhere__logos">
            {info[key].map((provider) => (
              <li key={provider.id}>
                <a
                  href={info.link}
                  target="_blank"
                  rel="noreferrer"
                  title={`${provider.name} (${label.toLowerCase()})`}
                  aria-label={`${provider.name}, ${label.toLowerCase()}, opens TMDb`}
                >
                  {provider.logo_path ? (
                    <img src={imageUrl(provider.logo_path, 'w92')} alt="" />
                  ) : (
                    <span>{provider.name}</span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="watchwhere__credit">Options and prices by JustWatch, via TMDb.</p>
    </section>
  )
}
