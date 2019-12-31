using UnityEngine;
using UnityEngine.UI;

public class GenericPlayerUserInterface : MonoBehaviour
{
  [SerializeField]
  private GameObject damageTextPrefab;
  [SerializeField]
  private Transform crossHair;
  public void Hit(float amount)
  {
    GameObject dText = GameObject.Instantiate(damageTextPrefab, crossHair.position, Quaternion.identity);
    dText.transform.SetParent(crossHair);
    dText.GetComponent<Text>().text = "" + amount;
  }
}
