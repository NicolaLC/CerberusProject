using UnityEngine;

public class DamageController : MonoBehaviour
{
  [SerializeField]
  private Transform healthBarFg;
  private GenericPlayerStatus status;
  private float maxHealth;

  private void Awake()
  {
    status = GetComponent<GenericPlayerStatus>();
    maxHealth = status.life;
  }

  public void Damage(float amout)
  {
    status.life -= amout;
    Vector3 localScale = healthBarFg.localScale;
    localScale.x = status.life / maxHealth;
    healthBarFg.localScale = localScale;
    if (status.life <= 0f)
    {
      GameObject.Destroy(gameObject);
    }
  }
}
