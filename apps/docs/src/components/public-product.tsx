export function PublicProduct() {
    return (
        <figure className="home-product-scene">
            <div className="home-product-ground" aria-hidden="true" />
            <div className="home-product-window">
                <img
                    className="home-shot home-shot-light"
                    src="/product/compose-light.webp"
                    alt="Postbot composer with shared content, destinations and scheduling"
                    width="1440"
                    height="1000"
                    fetchPriority="high"
                />
                <img
                    className="home-shot home-shot-dark"
                    src="/product/compose-dark.webp"
                    alt="Postbot composer in dark mode"
                    width="1440"
                    height="1000"
                    fetchPriority="high"
                />
            </div>
        </figure>
    )
}
